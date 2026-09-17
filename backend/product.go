package main

// Страницы товаров с правками из админки.
//
// Сами страницы собираются заранее и лежат на диске. Раньше nginx отдавал их
// напрямую, а переименование из админки подставлял скрипт уже в браузере —
// поэтому заголовок вкладки, превью ссылки в мессенджере, хлебные крошки и
// разметка для поисковиков оставались со старым именем. Теперь страница идёт
// через бекенд, и новое имя стоит в HTML с первого байта.

import (
	"encoding/json"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (с *Сервер) товар(w http.ResponseWriter, r *http.Request) {
	адрес := strings.Trim(strings.TrimPrefix(r.URL.Path, "/product/"), "/")
	// Адрес приходит из запроса — оставляем только латиницу, цифры и дефис,
	// чтобы чтение файла не ушло в чужую папку.
	адрес = толькоАдрес.ReplaceAllString(strings.ToLower(адрес), "")

	страница, err := os.ReadFile(filepath.Join(с.папкаСайта, "product", адрес, "index.html"))
	if адрес == "" || err != nil {
		с.ненайдено(w)
		return
	}

	// Без слеша на конце относительные пути на странице поехали бы
	if !strings.HasSuffix(r.URL.Path, "/") {
		http.Redirect(w, r, "/product/"+адрес+"/", http.StatusMovedPermanently)
		return
	}

	текст := string(страница)
	if т, п, ок := с.правкаТовара(адрес); ок {
		if п.Скрыт {
			http.Redirect(w, r, "/catalog/", http.StatusFound)
			return
		}
		if п.Название != "" && п.Название != т.Название {
			текст = переименовать(текст, т.Название, п.Название)
		}
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write([]byte(текст))
}

// правкаТовара находит товар по адресу и его правку из админки
func (с *Сервер) правкаТовара(адрес string) (Товар, Правка, bool) {
	for _, т := range читатьJSON(с.хранилище, "admin-products.json", []Товар{}) {
		if т.Адрес == адрес {
			п, есть := читатьJSON(с.хранилище, "overrides.json", map[string]Правка{})[т.Ид]
			return т, п, есть
		}
	}
	return Товар{}, Правка{}, false
}

// переименовать меняет имя товара только в известных местах разметки.
// Замена «везде подряд» опасна: имена — обычные слова («Орех», «Сталь»),
// и они встречаются в описаниях других товаров и в тексте страницы.
func переименовать(стр, было, стало string) string {
	б, с := html.EscapeString(было), html.EscapeString(стало)
	// В JSON-LD имя стоит строкой JSON; Marshal экранирует < и >, так что
	// закрыть тег script из админки не получится
	бJSON, _ := json.Marshal(было)
	сJSON, _ := json.Marshal(стало)

	return strings.NewReplacer(
		"<title>"+б+" — ", "<title>"+с+" — ",
		`content="`+б+" — ", `content="`+с+" — ",
		`"name":`+string(бJSON), `"name":`+string(сJSON),
		"<span>/</span>"+б+"\n", "<span>/</span>"+с+"\n",
		"<span>/</span>"+б+"<", "<span>/</span>"+с+"<",
		`alt="`+б+" — ", `alt="`+с+" — ",
		"<h1>"+б+"</h1>", "<h1>"+с+"</h1>",
		`data-name="`+б+`"`, `data-name="`+с+`"`,
	).Replace(стр)
}

func (с *Сервер) ненайдено(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	if стр, err := os.ReadFile(filepath.Join(с.папкаСайта, "404.html")); err == nil {
		w.Write(стр)
	}
}
