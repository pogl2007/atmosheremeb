package main

// Настройки. Раньше они лежали в public/config.php — то есть внутри папки,
// которую отдаёт веб-сервер, и защищались только правилом в конфиге nginx.
// Теперь секреты приходят переменными окружения из /etc/atmosfera/atmosfera.env
// (права 600, владелец root). Из веба этот файл недостижим в принципе,
// а не «потому что мы попросили сервер его не отдавать».

import (
	"log"
	"os"
	"strconv"
)

type Настройки struct {
	ТелеграмТокен string
	ТелеграмЧат   string

	АдресИИ string
	КлючИИ  string
	МодельИИ string

	СольАдмина    string
	ИтерацийАдмина int
	ХешАдмина     string

	ПапкаДанных string // /var/lib/atmosfera — вне корня сайта
	Сокет       string // unix-сокет, через который стучится nginx
}

func строка(имя, поумолчанию string) string {
	if v := os.Getenv(имя); v != "" {
		return v
	}
	return поумолчанию
}

func прочитатьНастройки() Настройки {
	н := Настройки{
		ТелеграмТокен:  os.Getenv("TELEGRAM_BOT_TOKEN"),
		ТелеграмЧат:    os.Getenv("TELEGRAM_CHAT_ID"),
		АдресИИ:        os.Getenv("AI_API_URL"),
		КлючИИ:         os.Getenv("AI_API_KEY"),
		МодельИИ:       строка("AI_MODEL", "gpt-5.4-mini"),
		СольАдмина:     os.Getenv("ADMIN_SALT"),
		ХешАдмина:      os.Getenv("ADMIN_HASH"),
		ПапкаДанных:    строка("DATA_DIR", "/var/lib/atmosfera"),
		Сокет:          строка("SOCKET", "/run/atmosfera/atmosfera.sock"),
	}

	итераций, err := strconv.Atoi(строка("ADMIN_ITER", "200000"))
	if err != nil || итераций < 1000 {
		log.Fatalf("ADMIN_ITER задан неверно (%q): нужно целое число не меньше 1000",
			os.Getenv("ADMIN_ITER"))
	}
	н.ИтерацийАдмина = итераций

	// Падаем сразу, а не при первой заявке в три часа ночи. Заявка, потерянная
	// из-за пустого токена, не восстанавливается: у клиента нет второй попытки.
	if н.ТелеграмТокен == "" || н.ТелеграмЧат == "" {
		log.Fatal("не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID — заявки некуда отправлять")
	}
	if н.ХешАдмина == "" || н.СольАдмина == "" {
		log.Fatal("не заданы ADMIN_HASH и ADMIN_SALT — в админку нельзя войти")
	}

	return н
}
