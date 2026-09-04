package main

// Хранилище. По-прежнему обычные JSON-файлы, а не база: нагрузка — один
// человек, который иногда что-то правит, и заводить ради этого СУБД значило бы
// добавить ещё одну службу, которую надо обслуживать и бэкапить.
//
// Отличие от прежней версии на PHP: файлы лежат вне корня сайта. Раньше журнал
// заявок с телефонами клиентов физически находился в раздаваемой папке, и его
// спасали два костыля — расширение .php и строка-заглушка внутри. Теперь
// веб-сервер до него не дотянется, даже если ошибиться в конфиге.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Заявка struct {
	Когда   string `json:"at"`
	Вид     string `json:"kind"`
	Имя     string `json:"name"`
	Телефон string `json:"phone"`
	Связь   string `json:"contact"`
	Текст   string `json:"text"`
}

type Статья struct {
	Адрес      string `json:"slug"`
	Заголовок  string `json:"title"`
	Описание   string `json:"lead"`
	Текст      string `json:"body"`
	Дата       string `json:"date"`
	ДатаЛюдям  string `json:"dateHuman"`
}

type Правка struct {
	Скрыт    bool   `json:"hidden,omitempty"`
	Цена     string `json:"price,omitempty"`
	Название string `json:"name,omitempty"`
}

type Товар struct {
	Ид       string `json:"id"`
	Адрес    string `json:"slug"`
	Название string `json:"name"`
	Раздел   string `json:"category"`
	Карточка string `json:"card"`
}

// Один замок на всё хранилище. Запись сюда идёт от силы несколько раз в день,
// поэтому разбираться с отдельными замками на каждый файл смысла нет,
// а один общий исключает целый класс ошибок.
type Хранилище struct {
	папка string
	замок sync.RWMutex
}

func открытьХранилище(папка string) (*Хранилище, error) {
	if err := os.MkdirAll(папка, 0o750); err != nil {
		return nil, err
	}
	return &Хранилище{папка: папка}, nil
}

func (х *Хранилище) путь(имя string) string { return filepath.Join(х.папка, имя) }

// ── Чтение и запись JSON ──

func читатьJSON[T any](х *Хранилище, имя string, поумолчанию T) T {
	х.замок.RLock()
	defer х.замок.RUnlock()

	данные, err := os.ReadFile(х.путь(имя))
	if err != nil {
		return поумолчанию
	}
	var v T
	if json.Unmarshal(данные, &v) != nil {
		// Битый файл не должен ронять админку: отдаём пустое значение,
		// а сам файл не трогаем — вдруг его ещё можно спасти руками.
		return поумолчанию
	}
	return v
}

func (х *Хранилище) писатьJSON(имя string, значение any) error {
	х.замок.Lock()
	defer х.замок.Unlock()

	данные, err := json.MarshalIndent(значение, "", "  ")
	if err != nil {
		return err
	}
	// Пишем через временный файл и переименование: если сервер умрёт посреди
	// записи, на диске останется прежняя целая версия, а не половина новой.
	врем := х.путь(имя + ".tmp")
	if err := os.WriteFile(врем, данные, 0o640); err != nil {
		return err
	}
	return os.Rename(врем, х.путь(имя))
}

// ── Сырое чтение файла, как есть (промпт ИИ) ──

func (х *Хранилище) читатьТекст(имя string) string {
	х.замок.RLock()
	defer х.замок.RUnlock()
	данные, err := os.ReadFile(х.путь(имя))
	if err != nil {
		return ""
	}
	return string(данные)
}

// То же, но отдаём как есть для браузера: blog.json и overrides.json
// фронтенд грузит сам. Раньше их раздавал nginx прямо из папки данных —
// теперь папки в вебруте нет, и эти два файла отдаёт сервер.
func (х *Хранилище) сырой(имя string) []byte {
	х.замок.RLock()
	defer х.замок.RUnlock()
	данные, err := os.ReadFile(х.путь(имя))
	if err != nil {
		return nil
	}
	return данные
}

// ── Журнал заявок ──
//
// Формат JSON Lines: одна заявка — одна дописанная строка. Так две
// одновременные заявки не портят файл, как испортила бы перезапись
// целого массива.

const ЖурналЗаявок = "orders.log"

func (х *Хранилище) записатьЗаявку(з Заявка) error {
	х.замок.Lock()
	defer х.замок.Unlock()

	з.Когда = time.Now().UTC().Format(time.RFC3339)
	строка, err := json.Marshal(з)
	if err != nil {
		return err
	}

	файл, err := os.OpenFile(х.путь(ЖурналЗаявок), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		return err
	}
	defer файл.Close()
	_, err = файл.Write(append(строка, '\n'))
	return err
}

// Последние заявки, новые сверху. Больше предела не читаем: за годы работы
// журнал вырастет, а в админке всё равно смотрят несколько последних.
func (х *Хранилище) заявки(предел int) []Заявка {
	х.замок.RLock()
	defer х.замок.RUnlock()

	данные, err := os.ReadFile(х.путь(ЖурналЗаявок))
	if err != nil {
		return nil
	}

	строки := strings.Split(strings.TrimSpace(string(данные)), "\n")
	var список []Заявка
	for i := len(строки) - 1; i >= 0 && len(список) < предел; i-- {
		s := strings.TrimSpace(строки[i])
		if s == "" {
			continue
		}
		var з Заявка
		if json.Unmarshal([]byte(s), &з) == nil {
			список = append(список, з)
		}
	}
	return список
}
