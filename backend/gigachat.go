package main

// GigaChat как поставщик ответов консультанта.
//
// Прежний провайдер то отключал модели, то отвечал 503, и консультант молчал.
// GigaChat отвечает за 1–4 секунды и работает из России без прокси.
//
// Две особенности, из-за которых нужен отдельный файл:
//
//  1. Доступ по короткоживущему токену: ключ авторизации меняется на токен
//     примерно на полчаса, дальше его нужно обновлять. Токен держим в памяти
//     и обновляем заранее, а не по ошибке 401.
//  2. Сертификат Сбера выдан удостоверяющим центром Минцифры, которого нет
//     в системном наборе Ubuntu. Готовые примеры советуют verify_ssl_certs=False,
//     то есть не проверять сертификат вовсе, — так делать нельзя: это снимает
//     защиту от подмены сервера. Вместо этого добавляем корневой сертификат
//     Минцифры в набор ТОЛЬКО для этого клиента. Остальной сервер и соседние
//     сайты продолжают доверять обычному системному набору.

import (
	"bufio"
	"context"
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const ГигаАдресТокена = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"

// Адрес чата настраивается: на api.giga.chat живут модели третьего поколения
// (GigaChat-3-Ultra и другие), которых нет на прежнем адресе.
const ГигаАдресЧатаПоУмолчанию = "https://api.giga.chat/v1/chat/completions"

type Гига struct {
	ключ   string // ключ авторизации (Basic), из /etc/atmosfera/atmosfera.env
	scope  string
	адрес  string
	клиент *http.Client

	замок   sync.Mutex
	токен   string
	годенДо time.Time
}

// открытьГигу собирает клиента с доверием к сертификату Минцифры.
// Пустой ключ — значит GigaChat не настроен, работаем на прежнем провайдере.
func открытьГигу(ключ, scope, путьСертификата, адресЧата string) (*Гига, error) {
	if ключ == "" {
		return nil, nil
	}
	if scope == "" {
		scope = "GIGACHAT_API_PERS"
	}
	if адресЧата == "" {
		адресЧата = ГигаАдресЧатаПоУмолчанию
	}

	набор, err := x509.SystemCertPool()
	if err != nil || набор == nil {
		набор = x509.NewCertPool()
	}
	pem, err := os.ReadFile(путьСертификата)
	if err != nil {
		return nil, fmt.Errorf("нет сертификата Минцифры %s: %w", путьСертификата, err)
	}
	if !набор.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("сертификат %s не разобрался", путьСертификата)
	}

	return &Гига{
		ключ:  ключ,
		scope: scope,
		адрес: адресЧата,
		клиент: &http.Client{
			Timeout:   90 * time.Second,
			Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: набор, MinVersion: tls.VersionTLS12}},
		},
	}, nil
}

// uuid4 — RqUID обязателен в запросе токена и должен быть уникальным
func uuid4() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// доступ отдаёт действующий токен, при необходимости получая новый
func (г *Гига) доступ() (string, error) {
	г.замок.Lock()
	defer г.замок.Unlock()

	// Минута запаса: токен не должен истечь между проверкой и запросом
	if г.токен != "" && time.Now().Add(time.Minute).Before(г.годенДо) {
		return г.токен, nil
	}

	тело := strings.NewReader(url.Values{"scope": {г.scope}}.Encode())
	запрос, _ := http.NewRequest(http.MethodPost, ГигаАдресТокена, тело)
	запрос.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	запрос.Header.Set("Accept", "application/json")
	запрос.Header.Set("RqUID", uuid4())
	запрос.Header.Set("Authorization", "Basic "+г.ключ)

	ответТок, err := г.клиент.Do(запрос)
	if err != nil {
		return "", err
	}
	defer ответТок.Body.Close()
	сырое, _ := io.ReadAll(io.LimitReader(ответТок.Body, 4096))
	if ответТок.StatusCode != http.StatusOK {
		return "", fmt.Errorf("токен не выдан, код %d: %s", ответТок.StatusCode, сырое)
	}

	var разбор struct {
		Токен   string `json:"access_token"`
		ДоКогда int64  `json:"expires_at"` // миллисекунды эпохи
	}
	if err := json.Unmarshal(сырое, &разбор); err != nil || разбор.Токен == "" {
		return "", errors.New("ответ на запрос токена не разобрался")
	}

	г.токен = разбор.Токен
	г.годенДо = time.UnixMilli(разбор.ДоКогда)
	if разбор.ДоКогда == 0 {
		г.годенДо = time.Now().Add(25 * time.Minute)
	}
	return г.токен, nil
}

// сообщения — системный промпт первым, затем переписка
func гигаСообщения(системный string, вход []map[string]string) []map[string]string {
	сообщения := []map[string]string{{"role": "system", "content": системный}}
	return append(сообщения, вход...)
}

func (г *Гига) запрос(ctx context.Context, тело map[string]any, ожидание time.Duration) (*http.Response, error) {
	полезное, _ := json.Marshal(тело)

	сделать := func() (*http.Response, error) {
		токен, err := г.доступ()
		if err != nil {
			return nil, err
		}
		запрос, _ := http.NewRequestWithContext(ctx, http.MethodPost, г.адрес, bytes.NewReader(полезное))
		запрос.Header.Set("Content-Type", "application/json")
		запрос.Header.Set("Accept", "application/json")
		запрос.Header.Set("Authorization", "Bearer "+токен)
		клиент := *г.клиент
		клиент.Timeout = ожидание
		return клиент.Do(запрос)
	}

	ответЧата, err := сделать()
	if err != nil {
		return nil, err
	}
	// Токен мог протухнуть раньше срока — сбрасываем и пробуем один раз ещё
	if ответЧата.StatusCode == http.StatusUnauthorized {
		ответЧата.Body.Close()
		г.замок.Lock()
		г.токен = ""
		г.замок.Unlock()
		return сделать()
	}
	return ответЧата, nil
}

// гигаОтвет — обычный ответ целиком
func (г *Гига) гигаОтвет(ctx context.Context, модель, системный string, вход []map[string]string, ожидание time.Duration) (string, error) {
	ответЧата, err := г.запрос(ctx, map[string]any{
		"model":      модель,
		"messages":   гигаСообщения(системный, вход),
		"max_tokens": 700,
	}, ожидание)
	if err != nil {
		return "", err
	}
	defer ответЧата.Body.Close()

	сырое, _ := io.ReadAll(io.LimitReader(ответЧата.Body, 1<<20))
	if ответЧата.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", ответЧата.StatusCode, обрезать(однойСтрокой(сырое), 300))
	}

	var разбор struct {
		Выбор []struct {
			Сообщение struct {
				Текст string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(сырое, &разбор); err != nil {
		return "", fmt.Errorf("ответ не разобрался: %w", err)
	}
	if len(разбор.Выбор) == 0 || strings.TrimSpace(разбор.Выбор[0].Сообщение.Текст) == "" {
		return "", errors.New("пустой ответ")
	}
	return strings.TrimSpace(разбор.Выбор[0].Сообщение.Текст), nil
}

// гигаПоток — ответ кусками, сразу в открытый поток браузера
func (г *Гига) гигаПоток(ctx context.Context, модель, системный string, вход []map[string]string,
	доПервогоКуска time.Duration, п *поток) error {

	ответЧата, err := г.запрос(ctx, map[string]any{
		"model":      модель,
		"messages":   гигаСообщения(системный, вход),
		"max_tokens": 700,
		"stream":     true,
	}, 0) // время ответа не ограничиваем: сторож ниже следит за первым куском
	if err != nil {
		return err
	}
	defer ответЧата.Body.Close()

	if ответЧата.StatusCode != http.StatusOK {
		сырое, _ := io.ReadAll(io.LimitReader(ответЧата.Body, 4096))
		return fmt.Errorf("HTTP %d: %s", ответЧата.StatusCode, обрезать(однойСтрокой(сырое), 300))
	}

	сторож := time.AfterFunc(доПервогоКуска, func() { ответЧата.Body.Close() })
	defer сторож.Stop()

	чтение := bufio.NewScanner(ответЧата.Body)
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
			Выбор []struct {
				Дельта struct {
					Текст string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(данные), &событие) != nil || len(событие.Выбор) == 0 {
			continue
		}
		кусок := событие.Выбор[0].Дельта.Текст
		if кусок == "" {
			continue
		}
		if !былКусок {
			былКусок = true
			сторож.Stop()
		}
		п.добавить(кусок)
	}
	if err := чтение.Err(); err != nil && !былКусок {
		return err
	}
	if !былКусок {
		return errors.New("пустой ответ")
	}
	return nil
}

// однойСтрокой — ответ сервиса в журнал пишем без переносов
func однойСтрокой(данные []byte) string {
	return strings.Join(strings.Fields(string(данные)), " ")
}
