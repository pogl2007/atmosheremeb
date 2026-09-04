package main

// Бекенд сайта «Атмосфера Мебель».
//
// Заменил собой PHP. Что изменилось по существу, а не по языку:
//
//   • Секреты уехали из корня сайта в переменные окружения. Раньше файл
//     с токеном Telegram и хешем пароля физически лежал в раздаваемой папке.
//   • Данные — журнал заявок, промпт ИИ — тоже уехали из корня сайта.
//     Раньше журнал с телефонами клиентов защищали расширение .php
//     и строка-заглушка внутри файла.
//   • Сервер слушает unix-сокет, а не порт. Из интернета к нему не подключиться
//     в обход nginx, поэтому заголовку с адресом посетителя можно верить.
//   • Разметку статей чистит настоящий разборщик HTML, а не strip_tags,
//     который пропускал атрибуты вроде onclick.
//
// Статику по-прежнему раздаёт nginx напрямую: сюда попадают только запросы
// к API, админке и статьям, добавленным через админку.

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

type Сервер struct {
	н          Настройки
	хранилище  *Хранилище
	папкаСайта string

	*Сессии
	клиент *http.Client

	лимитЗаявок *Ограничитель
	лимитЧата   *Ограничитель
	лимитПланов *Ограничитель
}

func main() {
	log.SetFlags(0) // время и так проставит journald

	н := прочитатьНастройки()

	хранилище, err := открытьХранилище(н.ПапкаДанных)
	if err != nil {
		log.Fatalf("не открыть папку данных %s: %v", н.ПапкаДанных, err)
	}

	с := &Сервер{
		н:          н,
		хранилище:  хранилище,
		папкаСайта: строка("SITE_DIR", "/var/www/atmospheremeb.ru"),
		Сессии:     новыеСессии(),
		клиент:     &http.Client{Timeout: 15 * time.Second},

		// Пределы те же, что были в PHP-версии.
		лимитЗаявок: новыйОграничитель(5, time.Minute),
		лимитЧата:   новыйОграничитель(15, time.Minute),
		лимитПланов: новыйОграничитель(5, time.Minute),
	}

	http.HandleFunc("/api/submit", с.заявка)
	http.HandleFunc("/api/chat", с.чат)
	http.HandleFunc("/api/plan", с.план)
	http.HandleFunc("/admin/", с.админка)
	http.HandleFunc("/blog/", с.блог)

	// Эти два файла фронтенд грузит сам. Раньше их раздавал nginx прямо
	// из папки данных — теперь папки в корне сайта нет.
	http.HandleFunc("/data/blog.json", с.отдатьДанные("blog.json", "[]"))
	http.HandleFunc("/data/overrides.json", с.отдатьДанные("overrides.json", "{}"))

	// Для systemd и для проверки, что служба жива
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	слушатель, err := открытьСокет(н.Сокет)
	if err != nil {
		log.Fatalf("не занять сокет %s: %v", н.Сокет, err)
	}

	сервер := &http.Server{
		ReadHeaderTimeout: 10 * time.Second,
		// Ответ ИИ-консультанта бывает долгим, поэтому запись не ограничиваем
		// жёстко — иначе сервер обрывал бы собственный ответ на полуслове.
		WriteTimeout: 130 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Даём доработать уже начатым запросам: иначе перезапуск во время
	// отправки заявки терял бы её молча.
	стоп := make(chan os.Signal, 1)
	signal.Notify(стоп, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-стоп
		ctx, отмена := context.WithTimeout(context.Background(), 15*time.Second)
		defer отмена()
		сервер.Shutdown(ctx)
	}()

	log.Printf("слушаю %s, данные в %s", н.Сокет, н.ПапкаДанных)
	if err := сервер.Serve(слушатель); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// Сокет остаётся файлом на диске после падения службы, и повторный запуск
// упёрся бы в «адрес занят». Поэтому старый файл убираем перед тем, как встать.
func открытьСокет(путь string) (net.Listener, error) {
	if err := os.MkdirAll(filepath.Dir(путь), 0o755); err != nil {
		return nil, err
	}
	os.Remove(путь)

	слушатель, err := net.Listen("unix", путь)
	if err != nil {
		return nil, err
	}
	// К сокету должен достучаться nginx, работающий под www-data.
	// Права даёт systemd через группу, здесь открываем доступ группе.
	if err := os.Chmod(путь, 0o660); err != nil {
		return nil, err
	}
	return слушатель, nil
}

// Статические статьи лежат на диске и отдаются nginx. Досюда доходит
// только то, чего на диске нет, — статьи из админки.
func (с *Сервер) блог(w http.ResponseWriter, r *http.Request) {
	// Прежний адрес вида /blog/post.php?slug=X. Он остался в ссылках,
	// разосланных до переезда, поэтому уводим на новый, а не теряем.
	if r.URL.Path == "/blog/post.php" {
		адресСтатьи := толькоАдрес.ReplaceAllString(r.URL.Query().Get("slug"), "")
		http.Redirect(w, r, "/blog/"+адресСтатьи+"/", http.StatusMovedPermanently)
		return
	}
	с.статья(w, r)
}

func (с *Сервер) отдатьДанные(имя, пусто string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		// Каталог и правки из админки должны подхватываться сразу
		w.Header().Set("Cache-Control", "no-cache")

		данные := с.хранилище.сырой(имя)
		if данные == nil {
			данные = []byte(пусто)
		}
		w.Write(данные)
	}
}
