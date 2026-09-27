package main

// Админка: заявки, блог, правки каталога.
//
// Пароль хранится хешем в переменных окружения. Открытого пароля нет нигде.
// Алгоритм тот же, что был в PHP-версии, — PBKDF2-SHA256 с той же солью
// и тем же числом итераций, поэтому при переезде пароль менять не пришлось.

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"html/template"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	КукаСессии     = "atmosfera_admin"
	ЖизньСессии    = 8 * time.Hour
	ЗаявокНаЭкран  = 200
	ТоваровНаЭкран = 200

	// Потолки полей из админки. Форма за паролем, но записанное здесь
	// уходит на публичные страницы и в каждый запрос каталога.
	пределЗаголовка = 200
	пределОписания  = 400
	пределСтатьи    = 100_000
)

var толькоАдрес = regexp.MustCompile(`[^a-z0-9-]`)

type Сессия struct {
	ТокенФормы string
	Истекает   time.Time
}

type Сессии struct {
	замок sync.Mutex
	живые map[string]Сессия
}

func новыеСессии() *Сессии {
	с := &Сессии{живые: map[string]Сессия{}}
	go с.убирать()
	return с
}

func (с *Сессии) создать() (string, string) {
	ключ := случайнаяСтрока()
	токен := случайнаяСтрока()

	с.замок.Lock()
	defer с.замок.Unlock()
	с.живые[ключ] = Сессия{ТокенФормы: токен, Истекает: time.Now().Add(ЖизньСессии)}
	return ключ, токен
}

func (с *Сессии) найти(ключ string) (Сессия, bool) {
	с.замок.Lock()
	defer с.замок.Unlock()

	сессия, есть := с.живые[ключ]
	if !есть || time.Now().After(сессия.Истекает) {
		delete(с.живые, ключ)
		return Сессия{}, false
	}
	return сессия, true
}

func (с *Сессии) закрыть(ключ string) {
	с.замок.Lock()
	defer с.замок.Unlock()
	delete(с.живые, ключ)
}

func (с *Сессии) убирать() {
	for range time.Tick(time.Hour) {
		с.замок.Lock()
		for ключ, сессия := range с.живые {
			if time.Now().After(сессия.Истекает) {
				delete(с.живые, ключ)
			}
		}
		с.замок.Unlock()
	}
}

func случайнаяСтрока() string {
	буфер := make([]byte, 32)
	if _, err := rand.Read(буфер); err != nil {
		// Без источника случайности предсказуемый ключ сессии пустил бы
		// в админку кого угодно. Лучше упасть, чем работать так.
		log.Fatalf("нет источника случайных чисел: %v", err)
	}
	return hex.EncodeToString(буфер)
}

/* ─────────── Пароль ─────────── */

// Сравнение за постоянное время: по скорости ответа пароль подобрать нельзя.
//
// 32 байта — это те же 64 шестнадцатеричных символа, что лежат в ADMIN_HASH.
// Разница между «длиной в байтах» и «длиной готовой строки» уже однажды
// стоила работающей админки: PHP-версия считала хеш вдвое короче нужного
// и не пускала вообще ни с каким паролем.
func (с *Сервер) парольВерный(введённый string) bool {
	ключ, err := pbkdf2.Key(sha256.New, введённый, []byte(с.н.СольАдмина),
		с.н.ИтерацийАдмина, 32)
	if err != nil {
		log.Printf("не посчитал хеш пароля: %v", err)
		return false
	}
	считанный := hex.EncodeToString(ключ)
	return subtle.ConstantTimeCompare([]byte(считанный), []byte(с.н.ХешАдмина)) == 1
}

/* ─────────── Обработчик ─────────── */

func (с *Сервер) админка(w http.ResponseWriter, r *http.Request) {
	// Админка не должна попадать ни в индекс, ни в кэш промежуточных серверов
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")

	// Скрипты на странице — только наши, помеченные разовым ключом. Даже если
	// в заявку или название товара когда-нибудь пролезет разметка, чужой
	// скрипт в админке не выполнится, а данные не уйдут на сторонний адрес.
	ключСкрипта := случайнаяСтрока()
	w.Header().Set("Content-Security-Policy", "default-src 'none'; "+
		"script-src 'nonce-"+ключСкрипта+"'; style-src 'unsafe-inline'; img-src 'self'; "+
		"form-action 'self'; base-uri 'none'; frame-ancestors 'none'")

	// Формам админки мегабайта с запасом; без предела ParseForm принял бы 10 МБ
	// от кого угодно, даже не вошедшего
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	ключ := ""
	if кука, err := r.Cookie(КукаСессии); err == nil {
		ключ = кука.Value
	}
	сессия, вошёл := с.Сессии.найти(ключ)

	if r.URL.Query().Get("logout") != "" {
		с.Сессии.закрыть(ключ)
		с.снятьКуку(w)
		http.Redirect(w, r, "/admin/", http.StatusSeeOther)
		return
	}

	сообщение := ""
	ошибкаВхода := ""

	if r.Method == http.MethodPost {
		r.ParseForm()

		if !вошёл {
			if пароль := r.PostFormValue("password"); пароль != "" {
				// Лимит попыток с адреса — основная защита от перебора. Одна
				// пауза не спасала: сто параллельных запросов ждут её одновременно.
				if с.лимитВходов.превышен(адрес(r)) {
					log.Printf("админка: слишком много попыток входа с %s", адрес(r))
					ошибкаВхода = "Слишком много попыток. Подождите десять минут."
				} else {
					// Пауза на живом человеке незаметна, а подбор замедляет
					time.Sleep(400 * time.Millisecond)
					if с.парольВерный(пароль) {
						новыйКлюч, _ := с.Сессии.создать()
						с.поставитьКуку(w, r, новыйКлюч)
						http.Redirect(w, r, "/admin/", http.StatusSeeOther)
						return
					}
					ошибкаВхода = "Неверный пароль"
				}
			}
		} else {
			// Любое изменение данных требует токен из формы: без него чужая
			// страница могла бы отправить запрос от имени администратора.
			if subtle.ConstantTimeCompare([]byte(r.PostFormValue("csrf")),
				[]byte(сессия.ТокенФормы)) != 1 {
				http.Error(w, "Неверный токен формы. Обновите страницу и попробуйте снова.", 400)
				return
			}
			сообщение = с.действие(r)
		}
	}

	if !вошёл {
		с.показатьВход(w, ошибкаВхода, ключСкрипта)
		return
	}
	с.показатьПанель(w, r, сессия, сообщение, ключСкрипта)
}

func (с *Сервер) поставитьКуку(w http.ResponseWriter, r *http.Request, ключ string) {
	http.SetCookie(w, &http.Cookie{
		Name:  КукаСессии,
		Value: ключ,
		Path:  "/admin/",
		// HttpOnly — куку нельзя прочитать из JavaScript, поэтому чужой скрипт
		//            на странице не угонит сеанс администратора.
		// SameSite  — браузер не пошлёт её при переходе с чужого сайта.
		// Secure    — только по https; на локальной машине по http иначе
		//             войти было бы невозможно.
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.Header.Get("X-Forwarded-Proto") == "https",
	})
}

func (с *Сервер) снятьКуку(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: КукаСессии, Value: "", Path: "/admin/", MaxAge: -1})
}

/* ─────────── Действия ─────────── */

func (с *Сервер) действие(r *http.Request) string {
	switch r.PostFormValue("действие") {

	case "статья":
		посты := читатьJSON(с.хранилище, "blog.json", []Статья{})

		// Адрес только латиницей: кириллица в ссылке превращается
		// в процентную кашу при копировании.
		адресСтатьи := толькоАдрес.ReplaceAllString(strings.ToLower(strings.TrimSpace(r.PostFormValue("slug"))), "")
		if адресСтатьи == "" {
			адресСтатьи = "post-" + time.Now().Format("20060102-150405")
		}

		заголовок := strings.TrimSpace(r.PostFormValue("title"))
		if заголовок == "" {
			return "Заголовок пустой — статья не сохранена"
		}
		текст := strings.TrimSpace(r.PostFormValue("body"))
		// Обрезать молча нельзя — пропал бы конец статьи. Лучше сказать.
		if utf8.RuneCountInString(текст) > пределСтатьи {
			return "Текст длиннее 100 000 символов — статья не сохранена"
		}

		теперь := time.Now()
		новая := Статья{
			Адрес:     адресСтатьи,
			Заголовок: обрезать(заголовок, пределЗаголовка),
			Описание:  обрезать(strings.TrimSpace(r.PostFormValue("lead")), пределОписания),
			Текст:     текст,
			Дата:      теперь.Format("2006-01-02"),
			ДатаЛюдям: теперь.Format("02.01.2006"),
		}

		// Правка существующей статьи, а не создание второй с тем же адресом
		оставшиеся := []Статья{новая}
		for _, п := range посты {
			if п.Адрес != адресСтатьи {
				оставшиеся = append(оставшиеся, п)
			}
		}
		if err := с.хранилище.писатьJSON("blog.json", оставшиеся); err != nil {
			log.Printf("не записал блог: %v", err)
			return "Не удалось записать файл блога"
		}
		return "Статья сохранена: /blog/" + адресСтатьи + "/"

	case "удалить-статью":
		адресСтатьи := r.PostFormValue("slug")
		посты := читатьJSON(с.хранилище, "blog.json", []Статья{})
		оставшиеся := []Статья{}
		for _, п := range посты {
			if п.Адрес != адресСтатьи {
				оставшиеся = append(оставшиеся, п)
			}
		}
		if err := с.хранилище.писатьJSON("blog.json", оставшиеся); err != nil {
			return "Не удалось записать файл"
		}
		return "Статья удалена"

	case "товар":
		ид := r.PostFormValue("id")
		// Правку принимаем только для товара, который есть в каталоге: иначе
		// в overrides.json, который грузит каждый посетитель, можно было бы
		// складывать что угодно под любыми ключами
		известен := false
		for _, т := range читатьJSON(с.хранилище, "admin-products.json", []Товар{}) {
			if т.Ид == ид {
				известен = true
				break
			}
		}
		if ид == "" || !известен {
			return "Такого товара нет в каталоге"
		}
		правки := читатьJSON(с.хранилище, "overrides.json", map[string]Правка{})

		// Те же пределы, что у полей формы: maxlength в браузере — подсказка,
		// а не защита
		запись := Правка{
			Скрыт:    r.PostFormValue("hidden") != "",
			Цена:     обрезать(strings.TrimSpace(r.PostFormValue("price")), 40),
			Название: обрезать(strings.TrimSpace(r.PostFormValue("name")), 60),
		}
		// Пустая запись — значит правок нет, и её надо убрать целиком,
		// иначе файл со временем зарастает пустышками.
		if запись == (Правка{}) {
			delete(правки, ид)
		} else {
			правки[ид] = запись
		}
		if err := с.хранилище.писатьJSON("overrides.json", правки); err != nil {
			return "Не удалось записать файл"
		}
		return "Правки сохранены"
	}
	return ""
}

/* ─────────── Показ ─────────── */

type даннымиПанели struct {
	Nonce     string
	Вкладка   string
	Сообщение string
	Токен     string
	Поиск     string

	Заявки []видЗаявки
	Посты  []Статья

	Товары       []видТовара
	ВсегоТоваров int
}

type видЗаявки struct {
	Когда   string
	Вид     string
	Телефон string
	Текст   string
}

type видТовара struct {
	Товар
	Правка Правка
}

func (с *Сервер) показатьВход(w http.ResponseWriter, ошибка, ключСкрипта string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := шаблонВхода.Execute(w, map[string]string{"Ошибка": ошибка, "Nonce": ключСкрипта}); err != nil {
		log.Printf("не отрисовал вход: %v", err)
	}
}

func (с *Сервер) показатьПанель(w http.ResponseWriter, r *http.Request, сессия Сессия, сообщение, ключСкрипта string) {
	вкладка := r.URL.Query().Get("t")
	if вкладка != "blog" && вкладка != "goods" {
		вкладка = "orders"
	}
	поиск := strings.TrimSpace(r.URL.Query().Get("q"))

	данные := даннымиПанели{
		Nonce:     ключСкрипта,
		Вкладка:   вкладка,
		Сообщение: сообщение,
		Токен:     сессия.ТокенФормы,
		Поиск:     поиск,
		Посты:     читатьJSON(с.хранилище, "blog.json", []Статья{}),
	}

	for _, з := range с.хранилище.заявки(ЗаявокНаЭкран) {
		когда := з.Когда
		if t, err := time.Parse(time.RFC3339, з.Когда); err == nil {
			когда = t.Local().Format("02.01.2006 15:04")
		}
		вид := з.Вид
		if вид == "" {
			вид = "?"
		}
		данные.Заявки = append(данные.Заявки, видЗаявки{
			Когда: когда, Вид: вид, Телефон: з.Телефон, Текст: з.Текст,
		})
	}

	товары := читатьJSON(с.хранилище, "admin-products.json", []Товар{})
	правки := читатьJSON(с.хранилище, "overrides.json", map[string]Правка{})

	if поиск != "" {
		искомое := strings.ToLower(поиск)
		отобранные := товары[:0:0]
		for _, т := range товары {
			где := strings.ToLower(т.Название + " " + т.Раздел)
			if strings.Contains(где, искомое) {
				отобранные = append(отобранные, т)
			}
		}
		товары = отобранные
	}
	данные.ВсегоТоваров = len(товары)

	if len(товары) > ТоваровНаЭкран {
		товары = товары[:ТоваровНаЭкран]
	}
	for _, т := range товары {
		данные.Товары = append(данные.Товары, видТовара{Товар: т, Правка: правки[т.Ид]})
	}

	// Статьи новые сверху — как это делала PHP-версия при сохранении
	sort.SliceStable(данные.Посты, func(i, j int) bool {
		return данные.Посты[i].Дата > данные.Посты[j].Дата
	})

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := шаблонПанели.Execute(w, данные); err != nil {
		log.Printf("не отрисовал панель: %v", err)
	}
}

var (
	шаблонВхода  = template.Must(template.New("вход").Parse(разметкаВхода))
	шаблонПанели = template.Must(template.New("панель").Parse(разметкаПанели))
)
