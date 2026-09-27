package main

// Тесты того, что ломается незаметно: очистка разметки статей (иначе XSS
// на публичной странице), очередь заявок (иначе теряются телефоны клиентов),
// лимиты и вход в админку.
//
// Запуск: cd backend && go test ./...

import (
	"bytes"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func тестовыйСервер(t *testing.T) *Сервер {
	t.Helper()
	хранилище, err := открытьХранилище(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ключ, _ := pbkdf2.Key(sha256.New, "верный-пароль", []byte("соль"), 1000, 32)
	return &Сервер{
		н: Настройки{
			СольАдмина: "соль", ИтерацийАдмина: 1000, ХешАдмина: hex.EncodeToString(ключ),
		},
		хранилище:   хранилище,
		папкаСайта:  t.TempDir(),
		Сессии:      новыеСессии(),
		лимитЗаявок: новыйОграничитель(5, time.Minute),
		лимитЧата:   новыйОграничитель(15, time.Minute),
		лимитПланов: новыйОграничитель(5, time.Minute),
		лимитВходов: новыйОграничитель(5, 10*time.Minute),
		лимитИИ:     новыйОграничитель(300, time.Hour),
	}
}

/* ─────────── Очистка разметки статей ─────────── */

func TestОчисткаРазметки(t *testing.T) {
	случаи := []struct{ вход, нельзя string }{
		{`<p onclick="alert(1)">текст</p>`, "onclick"},
		{`<script>alert(1)</script>`, "<script"},
		{`<img src=x onerror=alert(1)>`, "<img"},
		{`<a href="javascript:alert(1)">ссылка</a>`, "javascript:"},
		{`<a href=" JaVaScRiPt:alert(1)">ссылка</a>`, "javascript"},
		{`<a href="data:text/html,<script>">x</a>`, "data:"},
		{`<svg><script>alert(1)</script></svg>`, "<script"},
		{`<p style="background:url(x)">x</p>`, "style"},
		{`<iframe src="//evil"></iframe>`, "<iframe"},
		{`<a href="/ok" onmouseover="x()">x</a>`, "onmouseover"},
	}
	for _, с := range случаи {
		вывод := очиститьРазметку(с.вход)
		if strings.Contains(strings.ToLower(вывод), strings.ToLower(с.нельзя)) {
			t.Errorf("%q → %q: осталось %q", с.вход, вывод, с.нельзя)
		}
	}

	// Разрешённое должно доживать до страницы
	вывод := очиститьРазметку(`<h2>Заголовок</h2><p>Текст <a href="https://example.com/">ссылка</a></p>`)
	for _, нужно := range []string{"<h2>Заголовок</h2>", `<a href="https://example.com/">`} {
		if !strings.Contains(вывод, нужно) {
			t.Errorf("пропало %q в %q", нужно, вывод)
		}
	}
}

/* ─────────── Переименование товара ─────────── */

func TestПереименованиеНеВыходитИзScript(t *testing.T) {
	стр := `<title>Агат — витрина</title><script type="application/ld+json">{"name":"Агат"}</script><h1>Агат</h1>`
	вывод := переименовать(стр, "Агат", `</script><script>alert(1)</script>`)
	if strings.Contains(вывод, "<script>alert") {
		t.Fatalf("название из админки закрыло тег script: %s", вывод)
	}
	if !strings.Contains(переименовать(стр, "Агат", "Оникс"), "<h1>Оникс</h1>") {
		t.Fatal("заголовок не переименован")
	}
}

/* ─────────── Ограничитель ─────────── */

func TestОграничитель(t *testing.T) {
	о := новыйОграничитель(3, time.Minute)
	for i := 0; i < 3; i++ {
		if о.превышен("а") {
			t.Fatalf("запрос %d отклонён раньше предела", i+1)
		}
	}
	for i := 0; i < 100; i++ {
		if !о.превышен("а") {
			t.Fatal("запрос сверх предела пропущен")
		}
	}
	// Отклонённые не копятся: иначе память росла бы от каждого запроса
	if n := len(о.отметки["а"]); n > 3 {
		t.Fatalf("отметок %d, ожидалось не больше 3", n)
	}
	if о.превышен("б") {
		t.Fatal("другой адрес попал под чужой лимит")
	}
}

/* ─────────── Очередь недоставленных ─────────── */

func TestОчередьНеТеряетЗаявки(t *testing.T) {
	с := тестовыйСервер(t)

	с.вОчередь("первая")
	с.вОчередь("вторая")

	строки := с.забратьОчередь()
	if len(строки) != 2 {
		t.Fatalf("забрано %d, ожидалось 2", len(строки))
	}

	// Пока идёт досылка, приходит новая заявка — она не должна пропасть
	с.вОчередь("третья, пришла во время досылки")

	// Первая ушла, вторая не ушла
	с.вернутьВОчередь(строки[1:])

	if _, err := os.Stat(с.путьОчереди() + ".sending"); !os.IsNotExist(err) {
		t.Fatal("рабочий файл не убран после досылки")
	}
	осталось := с.забратьОчередь()
	все := strings.Join(осталось, "\n")
	for _, нужно := range []string{"вторая", "третья"} {
		if !strings.Contains(все, нужно) {
			t.Errorf("в очереди нет заявки %q: %v", нужно, осталось)
		}
	}
	if strings.Contains(все, "первая") {
		t.Error("досланная заявка осталась в очереди")
	}
}

func TestОчередьПодбираетРабочийФайлПослеПадения(t *testing.T) {
	с := тестовыйСервер(t)
	с.вОчередь("до падения")
	с.забратьОчередь() // служба «упала», не вернув очередь

	с.вОчередь("после перезапуска")
	строки := с.забратьОчередь()
	if len(строки) != 2 {
		t.Fatalf("после падения забрано %d, ожидалось 2: %v", len(строки), строки)
	}
}

/* ─────────── Заявки и план ─────────── */

func запросJSON(метод, путь string, тело any) *http.Request {
	данные, _ := json.Marshal(тело)
	r := httptest.NewRequest(метод, путь, bytes.NewReader(данные))
	r.Header.Set("X-Real-IP", "203.0.113.7")
	return r
}

func TestПланПринимаетТолькоPNG(t *testing.T) {
	с := тестовыйСервер(t)
	неPNG := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<html>не картинка</html>"))
	w := httptest.NewRecorder()
	с.план(w, запросJSON("POST", "/api/plan", map[string]any{
		"name": "Иван", "phone": "+79991234567", "image": неPNG,
	}))
	if w.Code != 400 {
		t.Fatalf("не-PNG принят, код %d", w.Code)
	}
}

func TestЗаявкаСлишкомБольшоеТело(t *testing.T) {
	с := тестовыйСервер(t)
	w := httptest.NewRecorder()
	с.заявка(w, запросJSON("POST", "/api/submit", map[string]any{
		"kind": "consult", "name": strings.Repeat("я", пределФормы), "phone": "+79991234567",
	}))
	if w.Code != 400 {
		t.Fatalf("тело больше предела принято, код %d", w.Code)
	}
}

func TestЗаявкаГородПроверяетПочту(t *testing.T) {
	if сообщениеГород(map[string]any{"email": "не почта @"}) != "" {
		t.Error("принят неверный адрес почты")
	}
	if !strings.Contains(сообщениеГород(map[string]any{"email": "a@b.ru"}), "a@b.ru") {
		t.Error("отклонён верный адрес почты")
	}
}

func TestПереводыСтрокНеПодделываютПоля(t *testing.T) {
	текст := сообщениеКонсультация(map[string]any{
		"name": "Иван\nТелефон: +70000000000", "phone": "+79991234567",
	})
	if strings.Count("\n"+текст, "\nТелефон:") != 1 {
		t.Fatalf("имя с переводом строки подделало поле:\n%s", текст)
	}
}

/* ─────────── Админка ─────────── */

func войти(с *Сервер, пароль string) *httptest.ResponseRecorder {
	форма := url.Values{"password": {пароль}}
	r := httptest.NewRequest("POST", "/admin/", strings.NewReader(форма.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("X-Real-IP", "198.51.100.1")
	w := httptest.NewRecorder()
	с.админка(w, r)
	return w
}

func TestАдминкаЛимитВходов(t *testing.T) {
	с := тестовыйСервер(t)
	for i := 0; i < 5; i++ {
		войти(с, "неверный")
	}
	// Шестая попытка — даже с верным паролем — отклоняется
	w := войти(с, "верный-пароль")
	if w.Code == http.StatusSeeOther {
		t.Fatal("после пяти неудач вход всё ещё открыт для перебора")
	}
	if !strings.Contains(w.Body.String(), "Слишком много попыток") {
		t.Fatal("нет сообщения о лимите")
	}
}

func TestАдминкаВходИЗаголовки(t *testing.T) {
	с := тестовыйСервер(t)
	w := войти(с, "верный-пароль")
	if w.Code != http.StatusSeeOther {
		t.Fatalf("верный пароль не пускает, код %d", w.Code)
	}
	кука := w.Result().Cookies()
	if len(кука) == 0 || !кука[0].HttpOnly || кука[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("кука сессии без HttpOnly/SameSite")
	}

	csp := w.Header().Get("Content-Security-Policy")
	for _, нужно := range []string{"default-src 'none'", "frame-ancestors 'none'", "script-src 'nonce-"} {
		if !strings.Contains(csp, нужно) {
			t.Errorf("в CSP нет %q: %s", нужно, csp)
		}
	}

	// Страница входа: у скрипта тот же nonce, что в заголовке
	w = войти(с, "")
	csp = w.Header().Get("Content-Security-Policy")
	начало := strings.Index(csp, "'nonce-") + len("'nonce-")
	ключ := csp[начало : начало+strings.Index(csp[начало:], "'")]
	if !strings.Contains(w.Body.String(), `<script nonce="`+ключ+`">`) {
		t.Fatal("скрипт страницы входа без nonce из заголовка — политика его заблокирует")
	}
}

func TestАдминкаБезТокенаФормыНичегоНеМеняет(t *testing.T) {
	с := тестовыйСервер(t)
	ключ, _ := с.Сессии.создать()
	форма := url.Values{"действие": {"статья"}, "title": {"Взлом"}, "csrf": {"чужой"}}
	r := httptest.NewRequest("POST", "/admin/", strings.NewReader(форма.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: КукаСессии, Value: ключ})
	w := httptest.NewRecorder()
	с.админка(w, r)
	if w.Code != 400 {
		t.Fatalf("запрос без токена формы принят, код %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(с.хранилище.папка, "blog.json")); err == nil {
		t.Fatal("статья записана без токена формы")
	}
}

func TestАдминкаПравкаТолькоИзвестногоТовара(t *testing.T) {
	с := тестовыйСервер(t)
	с.хранилище.писатьJSON("admin-products.json", []Товар{{Ид: "1", Адрес: "agat", Название: "Агат"}})
	ключ, токен := с.Сессии.создать()

	править := func(ид, имя string) {
		форма := url.Values{"действие": {"товар"}, "id": {ид}, "name": {имя}, "csrf": {токен}}
		r := httptest.NewRequest("POST", "/admin/?t=goods", strings.NewReader(форма.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.AddCookie(&http.Cookie{Name: КукаСессии, Value: ключ})
		с.админка(httptest.NewRecorder(), r)
	}
	править("выдуманный", "мусор")
	править("1", strings.Repeat("Я", 500))

	правки := читатьJSON(с.хранилище, "overrides.json", map[string]Правка{})
	if _, есть := правки["выдуманный"]; есть {
		t.Error("правка для несуществующего товара записана")
	}
	if n := len([]rune(правки["1"].Название)); n != 60 {
		t.Errorf("длина названия %d, ожидалось 60", n)
	}
}

/* ─────────── Поток ответа ИИ ─────────── */

func TestПотокПрячетМеткуМенеджера(t *testing.T) {
	w := httptest.NewRecorder()
	п, ок := новыйПоток(w)
	if !ок {
		t.Fatal("поток не создан")
	}
	// Метка приходит, разрезанная между кусками
	for _, кусок := range []string{"Позвоните нам [MAN", "AGER] пожалуйста"} {
		п.добавить(кусок)
	}
	п.завершить()

	тело := w.Body.String()
	if strings.Contains(тело, "MAN") {
		t.Fatalf("метка менеджера видна клиенту:\n%s", тело)
	}
	if !strings.Contains(тело, `"needsManager":true`) {
		t.Fatalf("метка не распознана:\n%s", тело)
	}
}
