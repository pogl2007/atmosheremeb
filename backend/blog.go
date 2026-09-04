package main

// Статьи, добавленные через админку.
//
// Три стартовые статьи собраны в статические страницы — им сервер не нужен,
// их отдаёт nginx. Сюда запрос попадает только если такой папки на диске нет:
// значит, статья появилась позже и лежит в blog.json.
//
// Вёрстку целиком готовит сборка: в /inc лежат шапка и подвал, между которыми
// вставляется статья. Никаких шаблонов страницы здесь нет намеренно — чем
// меньше вёрстки в бекенде, тем меньше расходится оформление сайта и статей.

import (
	"html"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/net/html/atom"
	xhtml "golang.org/x/net/html"
)

// Разрешённая разметка. Текст пишет владелец сайта через админку, за паролем,
// но вставленный из интернета кусок не должен притащить на страницу скрипт.
var разрешённыеТеги = map[atom.Atom]bool{
	atom.P: true, atom.H2: true, atom.H3: true, atom.Ul: true, atom.Ol: true,
	atom.Li: true, atom.B: true, atom.Strong: true, atom.I: true, atom.Em: true,
	atom.A: true, atom.Br: true, atom.Blockquote: true,
}

func (с *Сервер) статья(w http.ResponseWriter, r *http.Request) {
	адресСтатьи := strings.Trim(strings.TrimPrefix(r.URL.Path, "/blog/"), "/")
	// Адрес приходит из запроса — режем всё, кроме латиницы, цифр и дефиса,
	// иначе он мог бы увести чтение файла в чужую папку.
	адресСтатьи = толькоАдрес.ReplaceAllString(strings.ToLower(адресСтатьи), "")

	посты := читатьJSON(с.хранилище, "blog.json", []Статья{})

	var найдена *Статья
	for i := range посты {
		if посты[i].Адрес == адресСтатьи {
			найдена = &посты[i]
			break
		}
	}

	код := http.StatusOK
	статья := Статья{
		Заголовок: "Статья не найдена",
		Описание:  "Возможно, её удалили или адрес указан с опечаткой.",
		Текст:     `<p>Вернитесь к <a href="/blog/">списку статей</a> — там всё, что опубликовано.</p>`,
	}
	if найдена != nil {
		статья = *найдена
	} else {
		код = http.StatusNotFound
	}

	шапка, подвал, err := с.каркас()
	if err != nil {
		http.Error(w, "Страница временно недоступна", http.StatusInternalServerError)
		return
	}

	шапка = strings.NewReplacer(
		"{{TITLE}}", html.EscapeString(статья.Заголовок+" | Атмосфера Мебель"),
		"{{DESCRIPTION}}", html.EscapeString(статья.Описание),
		"{{CANONICAL}}", "/blog/"+html.EscapeString(адресСтатьи)+"/",
	).Replace(шапка)

	var стр strings.Builder
	стр.WriteString(шапка)
	стр.WriteString(`<div class="container">
  <nav class="crumbs">
    <a href="/">Главная</a><span>/</span><a href="/blog/">Блог</a><span>/</span>`)
	стр.WriteString(html.EscapeString(статья.Заголовок))
	стр.WriteString(`
  </nav>
  <article class="article">`)
	if статья.ДатаЛюдям != "" {
		стр.WriteString(`<span class="post-date">` + html.EscapeString(статья.ДатаЛюдям) + `</span>`)
	}
	стр.WriteString("<h1>" + html.EscapeString(статья.Заголовок) + "</h1>")
	стр.WriteString(очиститьРазметку(статья.Текст))
	стр.WriteString(`
    <p style="margin-top:34px;"><a href="/catalog/" class="btn btn-primary">Посмотреть каталог</a></p>
  </article>
</div>
`)
	стр.WriteString(подвал)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(код)
	w.Write([]byte(стр.String()))
}

// Шапку и подвал читаем с диска на каждый запрос, а не кешируем: статьи
// открывают редко, зато после пересборки сайта они сразу получают новое
// оформление, и перезапускать службу не нужно.
func (с *Сервер) каркас() (string, string, error) {
	шапка, err := os.ReadFile(filepath.Join(с.папкаСайта, "inc", "header.html"))
	if err != nil {
		return "", "", err
	}
	подвал, err := os.ReadFile(filepath.Join(с.папкаСайта, "inc", "footer.html"))
	if err != nil {
		return "", "", err
	}
	return string(шапка), string(подвал), nil
}

// Оставляем только безопасные теги и выбрасываем все атрибуты, кроме ссылки
// у <a>. Прежняя версия на PHP пользовалась strip_tags, а он атрибуты не
// трогает: разметка вида <p onclick="..."> проходила её насквозь.
func очиститьРазметку(сырое string) string {
	узлы, err := xhtml.ParseFragment(strings.NewReader(сырое), &xhtml.Node{
		Type: xhtml.ElementNode, Data: "div", DataAtom: atom.Div,
	})
	if err != nil {
		return html.EscapeString(сырое)
	}

	var из strings.Builder
	for _, узел := range узлы {
		записатьУзел(&из, узел)
	}
	return из.String()
}

func записатьУзел(из *strings.Builder, узел *xhtml.Node) {
	switch узел.Type {
	case xhtml.TextNode:
		из.WriteString(html.EscapeString(узел.Data))
		return

	case xhtml.ElementNode:
		if !разрешённыеТеги[узел.DataAtom] {
			// Сам тег выбрасываем, но текст внутри сохраняем: иначе абзац,
			// случайно завёрнутый в <div>, исчез бы со страницы целиком.
			for д := узел.FirstChild; д != nil; д = д.NextSibling {
				записатьУзел(из, д)
			}
			return
		}

		из.WriteString("<" + узел.Data)
		if узел.DataAtom == atom.A {
			for _, атрибут := range узел.Attr {
				if атрибут.Key == "href" && ссылкаБезопасна(атрибут.Val) {
					из.WriteString(` href="` + html.EscapeString(атрибут.Val) + `"`)
					break
				}
			}
		}
		из.WriteString(">")

		if узел.DataAtom != atom.Br {
			for д := узел.FirstChild; д != nil; д = д.NextSibling {
				записатьУзел(из, д)
			}
			из.WriteString("</" + узел.Data + ">")
		}
	}
}

// Пропускаем только обычные ссылки и якоря. Схема javascript: в href — это
// готовый скрипт, который выполнится по клику.
func ссылкаБезопасна(адрес string) bool {
	а := strings.ToLower(strings.TrimSpace(адрес))
	if strings.HasPrefix(а, "/") || strings.HasPrefix(а, "#") {
		return true
	}
	return strings.HasPrefix(а, "http://") || strings.HasPrefix(а, "https://") ||
		strings.HasPrefix(а, "mailto:") || strings.HasPrefix(а, "tel:")
}
