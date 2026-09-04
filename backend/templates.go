package main

// Разметка админки. Держим строками в коде, а не отдельными файлами: тогда
// собранная программа самодостаточна — один файл, который нечего потерять
// при выкладке и незачем защищать правилами веб-сервера.
//
// html/template экранирует всё подставляемое сам, с учётом места вставки:
// внутри атрибута иначе, чем в тексте. Это надёжнее ручного вызова функции
// экранирования на каждое поле, как было в PHP.

const стилиАдминки = `
  :root { --bg:#F1E4D2; --surface:#FDF8F0; --primary:#2C2C2C; --secondary:#5C554C;
          --accent:#C4956A; --accent-text:#7D5228; --accent-light:#F6EADA;
          --border:#DFCFB6; --green:#4A7C59; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg);
         color: var(--secondary); line-height: 1.6; padding: 20px; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { color: var(--primary); font-size: 24px; margin-bottom: 4px; }
  h2 { color: var(--primary); font-size: 19px; margin: 26px 0 12px; }
  a { color: var(--accent-text); }
  .top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .top .sp { margin-left: auto; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .tabs a { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--border);
            background: var(--surface); text-decoration: none; color: var(--secondary); font-size: 14px; }
  .tabs a.on { background: var(--accent-text); border-color: var(--accent-text); color: #fff; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          padding: 16px; margin-bottom: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 14px; }
  label { display: block; font-size: 13px; color: var(--secondary); margin: 10px 0 4px; }
  input, textarea, select { width: 100%; padding: 9px 11px; border: 1px solid var(--border);
          border-radius: 8px; background: var(--bg); font: inherit; font-size: 14px; color: var(--primary); }
  textarea { min-height: 190px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  button { padding: 9px 18px; border: none; border-radius: 999px; background: var(--accent-text);
           color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
  button.ghost { background: transparent; border: 1px solid var(--border); color: var(--secondary); }
  button.danger { background: #B3261E; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary); }
  td img { width: 42px; height: 52px; object-fit: cover; border-radius: 5px; display: block; }
  .flash { background: #e7f3ea; border: 1px solid var(--green); color: #2f5c3c;
           padding: 11px 15px; border-radius: 10px; margin-bottom: 16px; }
  .muted { color: var(--secondary); opacity: .75; font-size: 13px; }
  .err { color: #B3261E; font-size: 14px; margin-top: 8px; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .chip { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px;
          background: var(--bg); border: 1px solid var(--border); }
  /* --- Экран входа ------------------------------------------------------
     Отдельный блок: страница входа — единственное, что видит посторонний,
     поэтому она должна выглядеть как часть сайта, а не как тестовая форма. */
  .login { min-height: calc(100vh - 40px); display: flex; flex-direction: column;
           align-items: center; justify-content: center; gap: 18px; }
  .login-card { width: 100%; max-width: 380px; background: var(--surface);
           border: 1px solid var(--border); border-radius: 18px; padding: 34px 30px 30px;
           text-align: center; box-shadow: 0 18px 44px rgba(60, 40, 20, .10); }
  .login-logo { display: block; margin: 0 auto 14px; border-radius: 12px; }
  .login-brand { font-size: 12px; letter-spacing: .16em; text-transform: uppercase;
           color: var(--accent-text); margin-bottom: 10px; }
  .login-card h1 { font-size: 22px; margin-bottom: 6px; }
  .login-sub { font-size: 14px; color: var(--secondary); opacity: .8; margin-bottom: 22px; }
  .login-form { text-align: left; }
  .login-form label { margin: 0 0 6px; }
  .pw-wrap { position: relative; }
  .pw-wrap input { padding-right: 92px; }
  .pw-eye { position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
           background: transparent; border: none; color: var(--accent-text);
           font-size: 13px; padding: 6px 9px; border-radius: 7px; }
  .pw-eye:hover { background: var(--accent-light); }
  .login-go { width: 100%; margin-top: 18px; padding: 12px; font-size: 15px; }
  .login .err { text-align: left; }
  .login-foot { font-size: 12px; color: var(--secondary); opacity: .65; text-align: center; }
`

const разметкаВхода = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Админка — Атмосфера Мебель</title>
<style>` + стилиАдминки + `</style>
</head>
<body>
<div class="wrap">
  <div class="login">
    <div class="login-card">
      <img class="login-logo" src="/img/logo-mark.png"
           srcset="/img/logo-mark.png 1x, /img/logo-mark@2x.png 2x"
           width="56" height="56" alt="">
      <p class="login-brand">Атмосфера Мебель</p>
      <h1>Панель управления</h1>
      <p class="login-sub">Введите пароль, чтобы продолжить</p>

      <form method="post" class="login-form">
        <label for="pw">Пароль</label>
        <div class="pw-wrap">
          <input id="pw" type="password" name="password" autofocus
                 autocomplete="current-password" required>
          <button type="button" class="pw-eye" id="pwEye"
                  aria-label="Показать пароль" aria-pressed="false">Показать</button>
        </div>
        {{if .Ошибка}}<p class="err" role="alert">{{.Ошибка}}</p>{{end}}
        <button type="submit" class="login-go">Войти</button>
      </form>
    </div>

    <p class="login-foot">
      Служебная страница. Сессия закрывается через восемь часов или при выходе.
    </p>
  </div>

  <script>
    // Показ пароля — на телефоне без этого попасть по длинному паролю тяжело.
    (function () {
      var поле = document.getElementById('pw'), глаз = document.getElementById('pwEye');
      if (!поле || !глаз) return;
      глаз.addEventListener('click', function () {
        var открыт = поле.type === 'text';
        поле.type = открыт ? 'password' : 'text';
        глаз.textContent = открыт ? 'Показать' : 'Скрыть';
        глаз.setAttribute('aria-pressed', String(!открыт));
        глаз.setAttribute('aria-label', открыт ? 'Показать пароль' : 'Скрыть пароль');
        поле.focus();
      });
    })();
  </script>
</div>
</body>
</html>
`

const разметкаПанели = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Админка — Атмосфера Мебель</title>
<style>` + стилиАдминки + `</style>
</head>
<body>
<div class="wrap">

  <div class="top">
    <h1>Админка</h1>
    <span class="sp"></span>
    <a href="/" target="_blank">Открыть сайт ↗</a>
    <a href="?logout=1">Выйти</a>
  </div>

  {{if .Сообщение}}<div class="flash">{{.Сообщение}}</div>{{end}}

  <div class="tabs">
    <a href="?t=orders" class="{{if eq .Вкладка "orders"}}on{{end}}">Заявки ({{len .Заявки}})</a>
    <a href="?t=blog"   class="{{if eq .Вкладка "blog"}}on{{end}}">Блог ({{len .Посты}})</a>
    <a href="?t=goods"  class="{{if eq .Вкладка "goods"}}on{{end}}">Каталог</a>
  </div>

{{if eq .Вкладка "orders"}}

  {{if not .Заявки}}
    <div class="card">
      <p>Заявок пока нет.</p>
      <p class="muted">Сюда попадает всё, что ушло в Telegram: заявки из корзины, с форм и планы комнат.
        Если Telegram недоступен, заявка не сохраняется — журнал ведётся только после успешной отправки.</p>
    </div>
  {{else}}
    {{range .Заявки}}
      <div class="card">
        <div class="muted">
          {{.Когда}} · <span class="chip">{{.Вид}}</span>
          {{if .Телефон}} · <a href="tel:{{.Телефон}}">{{.Телефон}}</a>{{end}}
        </div>
        <pre>{{.Текст}}</pre>
      </div>
    {{end}}
  {{end}}

{{else if eq .Вкладка "blog"}}

  <h2>Новая статья</h2>
  <div class="card">
    <form method="post">
      <input type="hidden" name="csrf" value="{{.Токен}}">
      <input type="hidden" name="действие" value="статья">
      <div class="row2">
        <div>
          <label for="f-title">Заголовок</label>
          <input id="f-title" name="title" required>
        </div>
        <div>
          <label for="f-slug">Адрес (латиницей, без пробелов)</label>
          <input id="f-slug" name="slug" placeholder="kak-vybrat-shkaf">
        </div>
      </div>
      <label for="f-lead">Краткое описание — показывается в списке и в поиске</label>
      <input id="f-lead" name="lead">
      <label for="f-body">Текст. Разрешена разметка: &lt;p&gt;, &lt;h2&gt;, &lt;ul&gt;&lt;li&gt;, &lt;b&gt;, &lt;a&gt;</label>
      <textarea id="f-body" name="body" placeholder="&lt;p&gt;Первый абзац.&lt;/p&gt;"></textarea>
      <p style="margin-top:14px;"><button type="submit">Сохранить статью</button></p>
      <p class="muted" style="margin-top:8px;">
        Если указать адрес уже существующей статьи — она будет перезаписана.
      </p>
    </form>
  </div>

  <h2>Статьи, добавленные здесь</h2>
  {{if not .Посты}}
    <div class="card"><p class="muted">Пока ни одной. Три стартовые статьи вшиты в сайт и правятся в коде.</p></div>
  {{else}}
    {{range .Посты}}
      <div class="card">
        <strong>{{.Заголовок}}</strong>
        <div class="muted">{{.ДатаЛюдям}} ·
          <a href="/blog/{{.Адрес}}/" target="_blank">открыть ↗</a></div>
        <p style="margin-top:6px;">{{.Описание}}</p>
        <form method="post" style="margin-top:10px;"
              onsubmit="return confirm('Удалить статью безвозвратно?')">
          <input type="hidden" name="csrf" value="{{$.Токен}}">
          <input type="hidden" name="действие" value="удалить-статью">
          <input type="hidden" name="slug" value="{{.Адрес}}">
          <button class="danger" type="submit">Удалить</button>
        </form>
      </div>
    {{end}}
  {{end}}

{{else}}

  <h2>Каталог</h2>
  <div class="card">
    <p class="muted">
      Здесь можно скрыть товар с сайта, переименовать его или проставить цену.
      Правки применяются сразу, пересборка не нужна. Описания и фотографии
      задаются в коде — добавление новых товаров через админку не предусмотрено.
    </p>
    <form method="get" style="margin-top:12px;display:flex;gap:8px;">
      <input type="hidden" name="t" value="goods">
      <input name="q" value="{{.Поиск}}" placeholder="Поиск по названию или разделу">
      <button type="submit">Найти</button>
    </form>
  </div>

  <table>
    <tr><th></th><th>Товар</th><th>Раздел</th><th>Скрыть</th><th>Название</th><th>Цена</th><th></th></tr>
    {{range .Товары}}
      <tr>
        <td><img src="/{{.Карточка}}" alt="" loading="lazy"></td>
        <td>
          <a href="/product/{{.Адрес}}/" target="_blank">{{.Название}}</a>
          {{if .Правка.Скрыт}}<br><span class="chip">скрыт</span>{{end}}
        </td>
        <td>{{.Раздел}}</td>
        <form method="post">
          <input type="hidden" name="csrf" value="{{$.Токен}}">
          <input type="hidden" name="действие" value="товар">
          <input type="hidden" name="id" value="{{.Ид}}">
          <td><input type="checkbox" name="hidden" value="1" style="width:auto"
                     {{if .Правка.Скрыт}}checked{{end}}></td>
          <td><input name="name" value="{{.Правка.Название}}" placeholder="{{.Название}}"></td>
          <td><input name="price" value="{{.Правка.Цена}}" placeholder="договорная"></td>
          <td><button type="submit">OK</button></td>
        </form>
      </tr>
    {{end}}
  </table>
  {{if gt .ВсегоТоваров 200}}
    <p class="muted" style="margin-top:12px;">Показаны первые 200 из {{.ВсегоТоваров}} — уточните поиск.</p>
  {{end}}

{{end}}

</div>
</body>
</html>
`
