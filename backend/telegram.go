package main

// Доставка заявок в Telegram.
//
// 27.09.2026 заявки перестали уходить: провайдер режет часть адресов Telegram,
// и как раз тот, который отдаёт DNS (149.154.166.110), с сервера недоступен —
// соединение висит до таймаута. При этом соседний адрес того же API
// (149.154.167.220) отвечает за 0.14 с. Поэтому соединение устанавливаем сами:
// перебираем известные адреса и запоминаем тот, который ответил. Имя хоста
// в запросе и проверка сертификата остаются прежними — подменить сервер так
// нельзя, адрес обязан предъявить сертификат api.telegram.org.
//
// Вторая часть — очередь. Даже с перебором адресов Telegram может быть
// недоступен целиком, а заявка с телефоном клиента теряться не должна:
// не доставленные складываем на диск и досылаем в фоне.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Адреса дата-центров Bot API. Список нужен только чтобы обойти заблокированный
// адрес: сначала пробуем то, что дал DNS, потом остальные.
var адресаTelegram = []string{
	"149.154.167.220", "149.154.167.197", "149.154.175.50",
	"149.154.166.110", "91.108.4.5", "95.161.64.4",
}

type дозвон struct {
	живой string // адрес, который ответил в прошлый раз
	замок sync.Mutex
}

var дозвонTelegram = &дозвон{}

// соединить пробует запомненный адрес, затем DNS, затем список.
func (д *дозвон) соединить(ctx context.Context, сеть, куда string) (net.Conn, error) {
	хост, порт, err := net.SplitHostPort(куда)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(хост, "telegram.org") {
		return (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, сеть, куда)
	}

	д.замок.Lock()
	первый := д.живой
	д.замок.Unlock()

	варианты := []string{}
	if первый != "" {
		варианты = append(варианты, первый)
	}
	// IPv6 у сервера нет, поэтому берём только IPv4 из DNS
	if адреса, err := net.DefaultResolver.LookupIP(ctx, "ip4", хост); err == nil {
		for _, а := range адреса {
			варианты = append(варианты, а.String())
		}
	}
	варианты = append(варианты, адресаTelegram...)

	var последняя error
	видели := map[string]bool{}
	for _, адрес := range варианты {
		if видели[адрес] {
			continue
		}
		видели[адрес] = true

		соед, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp4", net.JoinHostPort(адрес, порт))
		if err != nil {
			последняя = err
			continue
		}
		д.замок.Lock()
		if д.живой != адрес {
			log.Printf("telegram: соединяюсь через %s", адрес)
			д.живой = адрес
		}
		д.замок.Unlock()
		return соед, nil
	}
	if последняя == nil {
		последняя = fmt.Errorf("нет доступных адресов %s", хост)
	}
	return nil, последняя
}

// клиентTelegram — отдельный клиент со своим способом дозвона
func новыйКлиентTelegram() *http.Client {
	return &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			DialContext:         дозвонTelegram.соединить,
			TLSHandshakeTimeout: 10 * time.Second,
		},
	}
}

/* ─────────── Очередь недоставленных ─────────── */

const ОчередьЗаявок = "undelivered.jsonl"

type вОчереди struct {
	Когда   string `json:"at"`
	Текст   string `json:"text"`
	Попыток int    `json:"tries"`
}

func (с *Сервер) вОчередь(текст string) {
	строка, _ := json.Marshal(вОчереди{Когда: time.Now().UTC().Format(time.RFC3339), Текст: текст})
	путь := filepath.Join(с.хранилище.папка, ОчередьЗаявок)
	файл, err := os.OpenFile(путь, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		log.Printf("очередь заявок недоступна: %v", err)
		return
	}
	defer файл.Close()
	файл.Write(append(строка, '\n'))
}

// досылать раз в минуту пробует отправить всё, что не ушло сразу.
// Запускается один раз при старте сервера.
func (с *Сервер) досылать() {
	for range time.Tick(time.Minute) {
		путь := filepath.Join(с.хранилище.папка, ОчередьЗаявок)
		сырое, err := os.ReadFile(путь)
		if err != nil || len(сырое) == 0 {
			continue
		}

		осталось := []string{}
		ушло := 0
		for _, строка := range strings.Split(strings.TrimSpace(string(сырое)), "\n") {
			if строка == "" {
				continue
			}
			var з вОчереди
			if json.Unmarshal([]byte(строка), &з) != nil {
				continue
			}
			if err := с.отправитьВТелеграм(з.Текст); err != nil {
				з.Попыток++
				// Сутки попыток — дальше только в журнале заявок и в админке
				if з.Попыток < 1440 {
					новая, _ := json.Marshal(з)
					осталось = append(осталось, string(новая))
				} else {
					log.Printf("заявка от %s так и не ушла в Telegram, осталась в журнале", з.Когда)
				}
				continue
			}
			ушло++
		}

		if ушло > 0 {
			log.Printf("дослано в Telegram: %d, ещё ждёт: %d", ушло, len(осталось))
		}
		if len(осталось) == 0 {
			os.Remove(путь)
		} else {
			os.WriteFile(путь, []byte(strings.Join(осталось, "\n")+"\n"), 0o640)
		}
	}
}

/* ─────────── Отправка ─────────── */

func (с *Сервер) отправитьВТелеграм(текст string) error {
	полезное, _ := json.Marshal(map[string]any{
		"chat_id": с.н.ТелеграмЧат,
		"text":    текст,
	})

	адресAPI := "https://api.telegram.org/bot" + с.н.ТелеграмТокен + "/sendMessage"
	ответТг, err := с.клиентТг.Post(адресAPI, "application/json", bytes.NewReader(полезное))
	if err != nil {
		return err
	}
	defer ответТг.Body.Close()

	var разбор struct {
		Ок       bool   `json:"ok"`
		Описание string `json:"description"`
	}
	json.NewDecoder(io.LimitReader(ответТг.Body, 4096)).Decode(&разбор)
	if !разбор.Ок {
		return fmt.Errorf("telegram отказал, код %d: %s", ответТг.StatusCode, разбор.Описание)
	}
	return nil
}
