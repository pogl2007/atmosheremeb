package main

// Ответ ИИ потоком.
//
// Раньше сайт ждал весь ответ целиком: 3–15 секунд в окне чата висело
// «печатает…», и казалось, что всё зависло. Теперь провайдер отдаёт ответ
// кусочками, мы сразу пересылаем их браузеру, и текст появляется на глазах.
//
// Формат обмена с сайтом — SSE (server-sent events): строки вида
//   data: {"delta":"часть текста"}
//   data: {"done":true,"needsManager":false}
// Выбран потому, что это обычный HTTP-ответ: ни вебсокетов, ни библиотек.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Метка для менеджера приходит в конце текста и не должна мелькать у клиента.
// Пока в хвосте есть незакрытая «[», придерживаем его до следующего куска.
const метка = "[MANAGER]"

type поток struct {
	w      http.ResponseWriter
	сброс  http.Flusher
	хвост  string          // придержанный кусок, в котором может начинаться метка
	Текст  strings.Builder // полный ответ — для журнала и разбора метки
	Отдано bool            // отправляли ли уже хоть что-то клиенту
}

func новыйПоток(w http.ResponseWriter) (*поток, bool) {
	сброс, ок := w.(http.Flusher)
	if !ок {
		return nil, false
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // nginx не должен копить ответ
	w.WriteHeader(http.StatusOK)
	сброс.Flush()
	return &поток{w: w, сброс: сброс}, true
}

func (п *поток) событие(значение any) {
	данные, _ := json.Marshal(значение)
	fmt.Fprintf(п.w, "data: %s\n\n", данные)
	п.сброс.Flush()
}

// добавить копит текст и отдаёт наружу всё, кроме возможного начала метки
func (п *поток) добавить(кусок string) {
	п.Текст.WriteString(кусок)
	буфер := п.хвост + кусок

	граница := strings.LastIndex(буфер, "[")
	if граница >= 0 && len(буфер)-граница < len(метка) && !strings.Contains(буфер, метка) {
		п.хвост = буфер[граница:]
		буфер = буфер[:граница]
	} else {
		п.хвост = ""
	}

	буфер = strings.ReplaceAll(буфер, метка, "")
	if буфер != "" {
		п.событие(map[string]string{"delta": буфер})
		п.Отдано = true
	}
}

// завершить досылает придержанный хвост и закрывает поток
func (п *поток) завершить() {
	if остаток := strings.ReplaceAll(п.хвост, метка, ""); остаток != "" {
		п.событие(map[string]string{"delta": остаток})
		п.Отдано = true
	}
	п.хвост = ""
	п.событие(map[string]any{
		"done":         true,
		"needsManager": strings.Contains(п.Текст.String(), метка),
	})
}

// спроситьИИПотоком ведёт один запрос к провайдеру и пересылает куски в поток.
// Пока ничего не отправлено клиенту (п.Отдано == false), ошибку ещё можно
// исправить — вызывающий перезапрашивает другую модель.
func (с *Сервер) спроситьИИПотоком(ctx context.Context, модель, системный string, вход []map[string]string,
	доПервогоКуска time.Duration, п *поток) error {

	if с.гига != nil {
		return с.гига.гигаПоток(ctx, модель, системный, вход, доПервогоКуска, п)
	}

	полезное, _ := json.Marshal(map[string]any{
		"model":             модель,
		"instructions":      системный,
		"input":             вход,
		"max_output_tokens": 700,
		"reasoning":         map[string]string{"effort": "low"},
		"store":             false,
		"stream":            true,
	})

	// Предел на весь ответ всё же нужен: без него провайдер, который шлёт
	// по байту в минуту, держал бы соединение вечно. Контекст от запроса
	// посетителя обрывает и чтение, если тот закрыл вкладку.
	ctx, отмена := context.WithTimeout(ctx, 2*time.Minute)
	defer отмена()

	запрос, err := http.NewRequestWithContext(ctx, http.MethodPost, с.н.АдресИИ, bytes.NewReader(полезное))
	if err != nil {
		return err
	}
	запрос.Header.Set("Content-Type", "application/json")
	запрос.Header.Set("Authorization", "Bearer "+с.н.КлючИИ)
	запрос.Header.Set("Accept", "text/event-stream")

	// Ограничение по времени снимаем с запроса целиком и вешаем на ожидание
	// первого куска: длинный ответ не должен обрываться на середине.
	клиент := &http.Client{Timeout: 0}
	ответИИ, err := клиент.Do(запрос)
	if err != nil {
		return err
	}
	defer ответИИ.Body.Close()

	if ответИИ.StatusCode != http.StatusOK {
		тело, _ := io.ReadAll(io.LimitReader(ответИИ.Body, 500))
		return fmt.Errorf("HTTP %d: %s", ответИИ.StatusCode, тело)
	}

	// Сторож: если первый кусок не пришёл вовремя, рвём соединение —
	// чтение ниже вернёт ошибку, и мы успеем переспросить другую модель.
	сторож := time.AfterFunc(доПервогоКуска, func() { ответИИ.Body.Close() })
	defer сторож.Stop()

	чтение := bufio.NewScanner(ответИИ.Body)
	чтение.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	былКусок := false
	for чтение.Scan() {
		строка := strings.TrimSpace(чтение.Text())
		if !strings.HasPrefix(строка, "data:") {
			continue
		}
		данные := strings.TrimSpace(strings.TrimPrefix(строка, "data:"))
		if данные == "" || данные == "[DONE]" {
			continue
		}
		var событие struct {
			Тип    string `json:"type"`
			Дельта string `json:"delta"`
		}
		if json.Unmarshal([]byte(данные), &событие) != nil {
			continue
		}
		if событие.Тип != "response.output_text.delta" || событие.Дельта == "" {
			continue
		}
		if !былКусок {
			былКусок = true
			// Пошёл текст — сторож больше не нужен, дальше ждём сколько нужно
			сторож.Stop()
		}
		п.добавить(событие.Дельта)
	}
	if err := чтение.Err(); err != nil && !былКусок {
		return err
	}
	if !былКусок {
		return errors.New("пустой ответ")
	}
	return nil
}
