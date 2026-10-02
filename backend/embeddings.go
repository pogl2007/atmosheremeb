package main

// Векторный поиск по справке (вторая половина гибридного поиска).
//
// BM25 ищет по словам и отлично берёт точные вопросы: «кухня с островом»,
// «шкаф-купе с зеркалом». Но на «мебель для готовки» он беспомощен — слова
// «кухня» в вопросе нет. Эту дыру закрывают векторы: близкие по смыслу тексты
// оказываются рядом, даже если написаны разными словами.
//
// Устройство:
//   - векторы записей считаются один раз и лежат в vectors.json рядом с базой;
//     при смене базы или модели пересчитываются сами;
//   - на вопрос считается один вектор, дальше косинус по памяти;
//   - результаты BM25 и векторов объединяются ранговым способом (RRF).
//
// Если сервис эмбеддингов не настроен или отвечает ошибкой, поиск молча
// остаётся чисто словарным: консультант продолжает работать.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const ФайлВекторов = "vectors.json"

// Векторизатор — то, что умеет превращать тексты в векторы
type Векторизатор interface {
	Векторы(ctx context.Context, тексты []string) ([][]float32, error)
	Имя() string
}

/* ─────────── Эмбеддинги GigaChat ─────────── */

type ГигаВекторы struct {
	гига   *Гига
	адрес  string
	модель string
}

func новыеГигаВекторы(г *Гига, адрес, модель string) *ГигаВекторы {
	if г == nil || модель == "" {
		return nil
	}
	if адрес == "" {
		адрес = "https://api.giga.chat/v1/embeddings"
	}
	return &ГигаВекторы{гига: г, адрес: адрес, модель: модель}
}

func (в *ГигаВекторы) Имя() string { return в.модель }

func (в *ГигаВекторы) Векторы(ctx context.Context, тексты []string) ([][]float32, error) {
	полезное, _ := json.Marshal(map[string]any{"model": в.модель, "input": тексты})

	токен, err := в.гига.доступ()
	if err != nil {
		return nil, err
	}
	запрос, _ := http.NewRequestWithContext(ctx, http.MethodPost, в.адрес, bytes.NewReader(полезное))
	запрос.Header.Set("Content-Type", "application/json")
	запрос.Header.Set("Authorization", "Bearer "+токен)

	ответВек, err := в.гига.клиент.Do(запрос)
	if err != nil {
		return nil, err
	}
	defer ответВек.Body.Close()

	сырое, _ := io.ReadAll(io.LimitReader(ответВек.Body, 32<<20))
	if ответВек.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", ответВек.StatusCode, обрезать(однойСтрокой(сырое), 200))
	}

	var разбор struct {
		Данные []struct {
			Вектор []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(сырое, &разбор); err != nil {
		return nil, err
	}
	if len(разбор.Данные) != len(тексты) {
		return nil, fmt.Errorf("просили %d векторов, пришло %d", len(тексты), len(разбор.Данные))
	}

	векторы := make([][]float32, len(разбор.Данные))
	for i, д := range разбор.Данные {
		векторы[i] = нормировать(д.Вектор)
	}
	return векторы, nil
}

/* ─────────── Векторы записей ─────────── */

// нормировать приводит вектор к единичной длине: тогда косинусная близость —
// это обычное скалярное произведение, без делений на каждом сравнении
func нормировать(в []float32) []float32 {
	сумма := 0.0
	for _, з := range в {
		сумма += float64(з) * float64(з)
	}
	if сумма == 0 {
		return в
	}
	длина := float32(math.Sqrt(сумма))
	из := make([]float32, len(в))
	for i, з := range в {
		из[i] = з / длина
	}
	return из
}

func близость(а, б []float32) float64 {
	if len(а) != len(б) || len(а) == 0 {
		return 0
	}
	сумма := 0.0
	for i := range а {
		сумма += float64(а[i]) * float64(б[i])
	}
	return сумма
}

type кэшВекторов struct {
	Модель  string      `json:"модель"`
	Отпечат string      `json:"отпечаток"` // хеш текстов: сменилась база — пересчитываем
	Векторы [][]float32 `json:"векторы"`
}

func отпечаток(тексты []string) string {
	х := sha256.New()
	for _, т := range тексты {
		х.Write([]byte(т))
		х.Write([]byte{0})
	}
	return hex.EncodeToString(х.Sum(nil))
}

// посчитатьВекторы отдаёт векторы для текстов записей: из кэша или из сервиса.
// Считается пачками: за один запрос сервис принимает ограниченный объём.
func посчитатьВекторы(в Векторизатор, папка string, тексты []string) ([][]float32, error) {
	путь := filepath.Join(папка, ФайлВекторов)
	отпеч := отпечаток(тексты)

	if сырое, err := os.ReadFile(путь); err == nil {
		var кэш кэшВекторов
		if json.Unmarshal(сырое, &кэш) == nil &&
			кэш.Модель == в.Имя() && кэш.Отпечат == отпеч && len(кэш.Векторы) == len(тексты) {
			return кэш.Векторы, nil
		}
	}

	ctx, отмена := context.WithTimeout(context.Background(), 10*time.Minute)
	defer отмена()

	const пачка = 32
	все := make([][]float32, 0, len(тексты))
	for начало := 0; начало < len(тексты); начало += пачка {
		конец := начало + пачка
		if конец > len(тексты) {
			конец = len(тексты)
		}
		часть, err := в.Векторы(ctx, тексты[начало:конец])
		if err != nil {
			return nil, err
		}
		все = append(все, часть...)
	}

	сырое, _ := json.Marshal(кэшВекторов{Модель: в.Имя(), Отпечат: отпеч, Векторы: все})
	if err := os.WriteFile(путь, сырое, 0o640); err != nil {
		log.Printf("векторы посчитаны, но не сохранились: %v", err)
	}
	return все, nil
}
