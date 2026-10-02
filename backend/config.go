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
	"time"
)

type Настройки struct {
	ТелеграмТокен string
	ТелеграмЧат   string

	АдресИИ  string
	КлючИИ   string
	МодельИИ string
	// Дешёвая модель для простых вопросов; пусто — всё идёт в МодельИИ
	ЛёгкаяМодельИИ string

	// GigaChat: ключ авторизации пуст — работаем на прежнем провайдере
	ГигаКлюч       string
	ГигаScope      string
	ГигаСертификат string
	ГигаАдресЧата  string
	// Эмбеддинги: пусто — поиск остаётся словарным
	МодельВекторов    string
	ГигаАдресВекторов string
	ОжиданиеЛёгкой time.Duration
	// Потолок вопросов консультанту в час со всего сайта — защита баланса
	ВопросовИИВЧас int

	СольАдмина     string
	ИтерацийАдмина int
	ХешАдмина      string

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
		МодельИИ:       строка("AI_MODEL", "gpt-5.6-terra"),
		ЛёгкаяМодельИИ: os.Getenv("AI_MODEL_LIGHT"),
		ГигаКлюч:       os.Getenv("GIGACHAT_AUTH_KEY"),
		ГигаScope:      строка("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
		ГигаСертификат: строка("GIGACHAT_CA", "/etc/atmosfera/ru-ca.pem"),
		ГигаАдресЧата:  os.Getenv("GIGACHAT_API_URL"),
		МодельВекторов:    os.Getenv("EMBEDDINGS_MODEL"),
		ГигаАдресВекторов: os.Getenv("EMBEDDINGS_URL"),
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

	// Сколько ждать лёгкую модель, прежде чем переспросить основную
	секунд, err := strconv.Atoi(строка("AI_LIGHT_TIMEOUT", "10"))
	if err != nil || секунд < 1 {
		секунд = 10
	}
	н.ОжиданиеЛёгкой = time.Duration(секунд) * time.Second

	вопросов, err := strconv.Atoi(строка("AI_LIMIT_HOUR", "300"))
	if err != nil || вопросов < 1 {
		вопросов = 300
	}
	н.ВопросовИИВЧас = вопросов

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
