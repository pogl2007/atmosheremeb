package main

// Приём заявок, ИИ-консультант и план комнаты.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	// Телефон принимаем строго в том виде, в каком его собирает маска на сайте.
	телефонВерный = regexp.MustCompile(`^\+7\d{10}$`)
	пробелы       = regexp.MustCompile(`[\r\n\t]+`)
	картинкаPNG   = regexp.MustCompile(`^data:image/png;base64,([A-Za-z0-9+/=]+)$`)
)

var подписиСвязи = map[string]string{
	"call": "Позвонить", "whatsapp": "WhatsApp", "telegram": "Telegram", "max": "Max",
}

// Переводы строк из пользовательского ввода вырезаем: иначе в сообщении
// для Telegram можно было бы подделать лишние строки вроде «Телефон: …».
func чистить(v any, предел int) string {
	s, _ := v.(string)
	return обрезать(strings.TrimSpace(пробелы.ReplaceAllString(s, " ")), предел)
}

// Режем по символам, а не по байтам: в кириллице символ занимает два байта,
// и обрезка по байтам разрубила бы букву пополам.
func обрезать(s string, предел int) string {
	руны := []rune(s)
	if len(руны) > предел {
		руны = руны[:предел]
	}
	return string(руны)
}

func ответ(w http.ResponseWriter, код int, данные map[string]any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(код)
	json.NewEncoder(w).Encode(данные)
}

// Настоящий адрес посетителя. Заголовок ставит nginx, и доверять ему можно:
// сервер слушает unix-сокет, до которого из интернета не достучаться,
// поэтому подделать заголовок снаружи нельзя. В версии на PHP всё было
// наоборот — там читался X-Forwarded-For прямо из запроса.
func адрес(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return "неизвестно"
}

// Пределы тела запроса. Раньше на любой адрес можно было прислать 12 МБ,
// и сервер держал их в памяти целиком: десяток параллельных запросов —
// и сотня мегабайт на ровном месте. Заявке и вопросу в чат хватает
// нескольких килобайт, только план комнаты несёт картинку.
const (
	пределФормы = 64 << 10
	пределПлана = 5 << 20 // PNG до 3 МБ, в base64 он на треть больше
)

// Сигнатура PNG. Регулярка проверяет только, что пришёл base64, —
// а внутри могло оказаться что угодно, и оно ушло бы в Telegram.
var началоPNG = []byte("\x89PNG\r\n\x1a\n")

func тело(r *http.Request, предел int64) map[string]any {
	m := map[string]any{}
	сырое, err := io.ReadAll(io.LimitReader(r.Body, предел))
	if err != nil {
		return m
	}
	json.Unmarshal(сырое, &m)
	return m
}

/* ─────────── Telegram ─────────── */

func (с *Сервер) отправитьФото(картинка []byte, подпись string) error {
	var буфер bytes.Buffer
	форма := multipart.NewWriter(&буфер)
	форма.WriteField("chat_id", с.н.ТелеграмЧат)
	форма.WriteField("caption", подпись)
	часть, err := форма.CreateFormFile("photo", "plan.png")
	if err != nil {
		return err
	}
	часть.Write(картинка)
	форма.Close()

	адресAPI := "https://api.telegram.org/bot" + с.н.ТелеграмТокен + "/sendPhoto"
	ответТг, err := с.клиентТг.Post(адресAPI, форма.FormDataContentType(), &буфер)
	if err != nil {
		return err
	}
	defer ответТг.Body.Close()

	var разбор struct {
		Ок bool `json:"ok"`
	}
	json.NewDecoder(ответТг.Body).Decode(&разбор)
	if !разбор.Ок {
		return fmt.Errorf("telegram отказал, код %d", ответТг.StatusCode)
	}
	return nil
}

/* ─────────── Заявки ─────────── */

func (с *Сервер) заявка(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		ответ(w, 405, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if с.лимитЗаявок.превышен(адрес(r)) {
		ответ(w, 429, map[string]any{"ok": false, "error": "Слишком много заявок. Попробуйте через минуту."})
		return
	}

	т := тело(r, пределФормы)

	// Ловушка: скрытое поле, которое видят и заполняют только боты.
	// Отвечаем «принято», чтобы бот не искал обход.
	if чистить(т["website"], 50) != "" {
		ответ(w, 200, map[string]any{"ok": true})
		return
	}

	вид := чистить(т["kind"], 20)
	var текст string
	switch вид {
	case "consult":
		текст = сообщениеКонсультация(т)
	case "order":
		текст = сообщениеКорзина(т)
	case "city":
		текст = сообщениеГород(т)
	default:
		ответ(w, 400, map[string]any{"ok": false, "error": "Неизвестный тип заявки"})
		return
	}
	if текст == "" {
		ответ(w, 400, map[string]any{"ok": false, "error": "Проверьте правильность заполнения полей"})
		return
	}

	// В журнал ошибок пишем факт, но не содержимое заявки: там имя
	// и телефон человека, а системный журнал читают шире, чем админку.
	доставлена := true
	if err := с.отправитьВТелеграм(текст); err != nil {
		log.Printf("заявка не ушла в Telegram: %v — кладу в очередь", err)
		доставлена = false
		с.вОчередь(текст)
	}

	// Пишем в журнал в любом случае: даже если Telegram недоступен, заявка
	// с телефоном клиента должна остаться — её видно в админке.
	if err := с.хранилище.записатьЗаявку(Заявка{
		Вид:        вид,
		Имя:        чистить(т["name"], 100),
		Телефон:    чистить(т["phone"], 30),
		Связь:      чистить(т["contact"], 20),
		Текст:      текст,
		Доставлена: доставлена,
	}); err != nil {
		log.Printf("заявка не записалась в журнал: %v", err)
		if !доставлена {
			// Ни Telegram, ни диск — обещать клиенту нечего
			ответ(w, 502, map[string]any{"ok": false, "error": "Не удалось отправить заявку, попробуйте позже"})
			return
		}
	}

	// Клиенту отвечаем «принято»: заявка сохранена и будет дослана,
	// повторно слать её не нужно.
	ответ(w, 200, map[string]any{"ok": true})
}

func имяИТелефон(т map[string]any) (string, string, bool) {
	имя := чистить(т["name"], 100)
	телефон := чистить(т["phone"], 30)
	if имя == "" || !телефонВерный.MatchString(телефон) {
		return "", "", false
	}
	return имя, телефон, true
}

func связь(т map[string]any) string {
	if подпись, есть := подписиСвязи[чистить(т["contact"], 20)]; есть {
		return подпись
	}
	return "Не указано"
}

func сообщениеКонсультация(т map[string]any) string {
	имя, телефон, ок := имяИТелефон(т)
	if !ок {
		return ""
	}

	город := чистить(т["city"], 50)
	if город == "" {
		город = "—"
	}

	стр := []string{
		"Новая заявка с сайта",
		"Имя: " + имя,
		"Телефон: " + телефон,
		"Город: " + город,
		"Связь: " + связь(т),
	}
	if источник := чистить(т["project"], 80); источник != "" {
		стр = append(стр, "Источник: "+источник)
	}
	if о := чистить(т["summary"], 400); о != "" {
		стр = append(стр, "", "О клиенте (о чём спрашивал в чате):", о)
	}
	return strings.Join(стр, "\n")
}

func сообщениеКорзина(т map[string]any) string {
	имя, телефон, ок := имяИТелефон(т)
	if !ок {
		return ""
	}

	var позиции []string
	for _, п := range strings.Split(чистить(т["project"], 1500), ";") {
		if п = strings.TrimSpace(п); п != "" {
			позиции = append(позиции, п)
		}
	}

	стр := []string{
		"ЗАЯВКА ИЗ КОРЗИНЫ",
		"Имя: " + имя,
		"Телефон: " + телефон,
		"Связь: " + связь(т),
		"",
		fmt.Sprintf("Позиций: %d", len(позиции)),
	}
	for i, п := range позиции {
		стр = append(стр, fmt.Sprintf("%d. %s", i+1, п))
	}
	if о := чистить(т["summary"], 400); о != "" {
		стр = append(стр, "", о)
	}
	return strings.Join(стр, "\n")
}

func сообщениеГород(т map[string]any) string {
	почта := чистить(т["email"], 200)
	разобран, err := mail.ParseAddress(почта)
	if err != nil {
		return ""
	}
	return "Запрос на новый город\nEmail: " + разобран.Address
}

/* ─────────── План комнаты ─────────── */

func (с *Сервер) план(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		ответ(w, 405, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if с.лимитПланов.превышен(адрес(r)) {
		ответ(w, 200, map[string]any{"ok": false})
		return
	}

	т := тело(r, пределПлана)
	if чистить(т["website"], 50) != "" {
		ответ(w, 200, map[string]any{"ok": true})
		return
	}

	имя, телефон, ок := имяИТелефон(т)
	if !ок {
		ответ(w, 400, map[string]any{"ok": false, "error": "Проверьте имя и телефон"})
		return
	}

	картинка, _ := т["image"].(string)
	совпало := картинкаPNG.FindStringSubmatch(картинка)
	if совпало == nil {
		ответ(w, 400, map[string]any{"ok": false, "error": "Ожидается PNG в base64"})
		return
	}
	двоичное, err := base64.StdEncoding.DecodeString(совпало[1])
	if err != nil || !bytes.HasPrefix(двоичное, началоPNG) {
		ответ(w, 400, map[string]any{"ok": false, "error": "Ожидается PNG в base64"})
		return
	}
	if len(двоичное) > 3_000_000 {
		ответ(w, 413, map[string]any{"ok": false, "error": "Слишком большой файл"})
		return
	}

	// Подпись к снимку — это и есть заявка: в Telegram она видна прямо
	// под картинкой, отдельным сообщением дублировать не нужно.
	// Каждое поле чистим по отдельности, а переводы строк ставим уже потом:
	// чистить() их вырезает, и склеенную подпись он бы схлопнул в одну строку.
	подпись := обрезать(strings.Join([]string{
		"ПЛАН КОМНАТЫ С САЙТА",
		"Имя: " + имя,
		"Телефон: " + телефон,
		"Связь: " + связь(т),
		"Комната: " + илиПрочерк(чистить(т["room"], 40)),
		"Размеры: " + илиПрочерк(чистить(т["size"], 40)),
		"Мебель: " + илиПрочерк(чистить(т["items"], 400)),
	}, "\n"), 1024) // ограничение Telegram на подпись к фото

	if err := с.отправитьФото(двоичное, подпись); err != nil {
		log.Printf("план не ушёл в Telegram: %v", err)
		ответ(w, 200, map[string]any{"ok": false})
		return
	}
	ответ(w, 200, map[string]any{"ok": true})
}

func илиПрочерк(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

/* ─────────── ИИ-консультант ─────────── */

func (с *Сервер) чат(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		ответ(w, 405, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	// Код 200 с ok:false — это штатный откат сайта на заготовленные ответы,
	// а не сбой. Так консоль браузера остаётся чистой.
	if с.гига == nil && (с.н.АдресИИ == "" || с.н.КлючИИ == "") {
		ответ(w, 200, map[string]any{"ok": false, "error": "AI не настроен"})
		return
	}
	if с.лимитЧата.превышен(адрес(r)) {
		ответ(w, 200, map[string]any{"ok": false, "error": "Слишком много сообщений, подождите минуту."})
		return
	}
	if с.лимитИИ.превышен("весь сайт") {
		log.Print("чат: исчерпан часовой потолок вопросов (AI_LIMIT_HOUR)")
		ответ(w, 200, map[string]any{"ok": false, "error": "AI недоступен"})
		return
	}

	т := тело(r, пределФормы)
	вопрос := чистить(т["message"], 500)
	if вопрос == "" {
		ответ(w, 400, map[string]any{"ok": false, "error": "Пустой вопрос"})
		return
	}

	// Жёсткие рамки: бот не должен выдумывать цены, сроки и условия.
	// Промпт лежит отдельным файлом, собранным из site/facts.js — так факты
	// о компании гарантированно совпадают с текстами сайта.
	системный := strings.TrimSpace(с.хранилище.читатьТекст("ai-prompt.txt"))
	if системный == "" {
		log.Print("нет файла ai-prompt.txt — соберите сайт: node tools/build-site.js")
		ответ(w, 200, map[string]any{"ok": false, "error": "AI не настроен"})
		return
	}

	вход := []map[string]string{}
	if история, ок := т["history"].([]any); ок {
		// Берём последние шесть реплик: больше не нужно, а платить
		// за токены всей переписки при каждом вопросе — нужно.
		начало := len(история) - 6
		if начало < 0 {
			начало = 0
		}
		for _, реплика := range история[начало:] {
			if текст := чистить(реплика, 500); текст != "" {
				вход = append(вход, map[string]string{"role": "user", "content": текст})
			}
		}
	}
	вход = append(вход, map[string]string{"role": "user", "content": вопрос})

	// Сайт просит поток — отдаём ответ кусками, чтобы он печатался на глазах
	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		с.чатПотоком(r.Context(), w, вопрос, системный, вход)
		return
	}

	// Простые вопросы — в лёгкую модель, остальное — в основную. Лёгкая у
	// провайдера нестабильна по скорости (от 3 до 60+ секунд), поэтому ждём её
	// недолго и при любой неудаче переспрашиваем основную: клиент не должен
	// видеть «AI недоступен» из-за экономии.
	модель := с.н.МодельИИ
	лёгкий := с.н.ЛёгкаяМодельИИ != "" && простойВопрос(вопрос, len(вход)-1)
	var текст string
	var err error
	if лёгкий {
		модель = с.н.ЛёгкаяМодельИИ
		текст, err = с.спроситьИИ(r.Context(), модель, системный, вход, с.н.ОжиданиеЛёгкой)
		if err != nil {
			log.Printf("лёгкая модель %s: %v — переспрашиваю %s", модель, err, с.н.МодельИИ)
			модель = с.н.МодельИИ
		}
	}
	if !лёгкий || err != nil {
		текст, err = с.спроситьИИ(r.Context(), модель, системный, вход, 25*time.Second)
	}
	if err != nil {
		log.Printf("ИИ (%s): %v", модель, err)
		ответ(w, 200, map[string]any{"ok": false, "error": "AI недоступен"})
		return
	}

	// Какая модель ответила — видно в журнале, по нему считаем расходы
	log.Printf("чат: ответила %s", модель)

	нуженМенеджер := strings.Contains(текст, "[MANAGER]")
	текст = strings.TrimSpace(strings.ReplaceAll(текст, "[MANAGER]", ""))

	ответ(w, 200, map[string]any{"ok": true, "answer": текст, "needsManager": нуженМенеджер})
}

// спроситьИИ — один запрос к провайдеру, возвращает текст ответа.
// Контекст — от запроса посетителя: закрыл вкладку — запрос к провайдеру
// обрывается, и мы не платим за ответ, который некому показать.
func (с *Сервер) спроситьИИ(ctx context.Context, модель, системный string, вход []map[string]string, ожидание time.Duration) (string, error) {
	if с.гига != nil {
		return с.гига.гигаОтвет(ctx, модель, системный, вход, ожидание)
	}
	полезное, _ := json.Marshal(map[string]any{
		"model":        модель,
		"instructions": системный,
		"input":        вход,
		// Запас с избытком: часть лимита съедают невидимые reasoning-токены.
		"max_output_tokens": 700,
		"reasoning":         map[string]string{"effort": "low"},
		"store":             false,
	})

	запрос, err := http.NewRequestWithContext(ctx, http.MethodPost, с.н.АдресИИ, bytes.NewReader(полезное))
	if err != nil {
		return "", err
	}
	запрос.Header.Set("Content-Type", "application/json")
	запрос.Header.Set("Authorization", "Bearer "+с.н.КлючИИ)

	ответИИ, err := (&http.Client{Timeout: ожидание}).Do(запрос)
	if err != nil {
		return "", err
	}
	defer ответИИ.Body.Close()

	// Провайдер отвечает ошибкой (сменил модели, кончился баланс) — отдаём его
	// текст в журнал, иначе причина видна только как «пустой ответ»
	if ответИИ.StatusCode != http.StatusOK {
		тело, _ := io.ReadAll(io.LimitReader(ответИИ.Body, 500))
		return "", fmt.Errorf("HTTP %d: %s", ответИИ.StatusCode, тело)
	}

	// В ответе нет output_text: первым в output идёт элемент reasoning,
	// поэтому текст ищем в элементе с типом message.
	var разбор struct {
		Output []struct {
			Тип     string `json:"type"`
			Content []struct {
				Текст string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.NewDecoder(ответИИ.Body).Decode(&разбор); err != nil {
		return "", fmt.Errorf("не разобрал ответ: %w", err)
	}

	var куски []string
	for _, элемент := range разбор.Output {
		if элемент.Тип != "message" {
			continue
		}
		for _, часть := range элемент.Content {
			if часть.Текст != "" {
				куски = append(куски, часть.Текст)
			}
		}
	}
	текст := strings.TrimSpace(strings.Join(куски, " "))
	if текст == "" {
		return "", errors.New("пустой ответ")
	}
	return текст, nil
}

// Признаки вопроса, где нужно рассуждать: расчёт, размеры, выбор между
// вариантами, конкретная комната клиента.
var признакиСложного = []string{
	"размер", "метр", " м2", "м²", "кв.", "см ", "ширин", "длин", "глубин", "высот",
	"планиров", "проект", "посовет", "подойд", "подход", "лучше", "выбра", "выбор",
	"сравн", "отлич", "разниц", "или ", "почему", "как сделать", "как лучше",
	"материал", "лдсп", "мдф", "эмал", "пластик", "фурнитур", "столешниц",
	"моя кухня", "у меня", "нам нужно", "мне нужно", "помещени", "комнат", "ниш",
}

// простойВопрос — короткий вопрос о фактах компании без контекста переписки:
// гарантия, сроки, регионы, привет. Ошибиться в сторону «сложного» дешевле,
// чем отдать лёгкой модели вопрос, где она напутает.
func простойВопрос(вопрос string, репликВИстории int) bool {
	в := strings.ToLower(вопрос)
	if utf8.RuneCountInString(в) > 90 || репликВИстории > 2 || strings.Count(в, "?") > 1 {
		return false
	}
	for _, ц := range в {
		if unicode.IsDigit(ц) {
			return false
		}
	}
	for _, п := range признакиСложного {
		if strings.Contains(в+" ", п) {
			return false
		}
	}
	return true
}

// чатПотоком — тот же выбор модели, что и обычный ответ, но текст уходит
// клиенту по мере готовности. Пока ни одного куска не отправлено, неудачу
// лёгкой модели ещё можно исправить, переспросив основную.
func (с *Сервер) чатПотоком(ctx context.Context, w http.ResponseWriter, вопрос, системный string, вход []map[string]string) {
	п, ок := новыйПоток(w)
	if !ок {
		ответ(w, 200, map[string]any{"ok": false, "error": "AI недоступен"})
		return
	}

	модель := с.н.МодельИИ
	лёгкий := с.н.ЛёгкаяМодельИИ != "" && простойВопрос(вопрос, len(вход)-1)
	var err error
	if лёгкий {
		модель = с.н.ЛёгкаяМодельИИ
		err = с.спроситьИИПотоком(ctx, модель, системный, вход, с.н.ОжиданиеЛёгкой, п)
		if err != nil && !п.Отдано {
			log.Printf("лёгкая модель %s: %v — переспрашиваю %s", модель, err, с.н.МодельИИ)
			модель = с.н.МодельИИ
		}
	}
	if (!лёгкий || err != nil) && !п.Отдано {
		err = с.спроситьИИПотоком(ctx, модель, системный, вход, 25*time.Second, п)
	}

	if err != nil && !п.Отдано {
		log.Printf("ИИ (%s): %v", модель, err)
		п.событие(map[string]any{"error": "AI недоступен"})
		return
	}
	if err != nil {
		// Часть ответа клиент уже видит — дописать её нечем, но и рвать нечестно
		log.Printf("ИИ (%s) оборвался на середине: %v", модель, err)
	}
	log.Printf("чат: ответила %s (потоком)", модель)
	п.завершить()
}
