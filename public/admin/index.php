<?php
// Админка: заявки, блог, правки каталога.
//
// Данные лежат в обычных JSON-файлах, а не в базе. Причины две:
// на дешёвом хостинге PDO SQLite включён не всегда, а нагрузка здесь —
// один человек, который иногда что-то правит. Запись идёт с LOCK_EX.
//
// Пароль хранится хешем в config.php. Открытого пароля нет нигде.

require __DIR__ . '/../config.php';

// Куку сессии закрываем до её создания, иначе настройки не применятся.
//   httponly — куку нельзя прочитать из JavaScript, поэтому чужой скрипт
//              на странице не угонит сеанс администратора;
//   samesite — браузер не пошлёт её при переходе с чужого сайта, что само
//              по себе закрывает межсайтовые запросы;
//   secure   — только по https; включаем, если соединение защищено, иначе
//              на локальной машине по http войти было бы невозможно.
$поHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Strict',
    'secure'   => $поHttps,
]);
session_start();

// Админка не должна попадать ни в индекс, ни в кэш промежуточных серверов
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store, private');
header('X-Frame-Options: DENY');            // защита от кликджекинга
header('X-Content-Type-Options: nosniff');

const ЗАЯВКИ     = __DIR__ . '/../data/orders.log.php';
const БЛОГ       = __DIR__ . '/../data/blog.json';
const ПРАВКИ     = __DIR__ . '/../data/overrides.json';
const ТОВАРЫ     = __DIR__ . '/../data/admin-products.json';

function h($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

function читатьJson($файл, $поумолчанию = []) {
    if (!is_file($файл)) return $поумолчанию;
    $d = json_decode((string) file_get_contents($файл), true);
    return is_array($d) ? $d : $поумолчанию;
}

function писатьJson($файл, $данные) {
    $папка = dirname($файл);
    if (!is_dir($папка)) @mkdir($папка, 0755, true);
    return file_put_contents($файл,
        json_encode($данные, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
        LOCK_EX) !== false;
}

/* ─────────── Вход ─────────── */

if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: ?');
    exit;
}

$ошибкаВхода = '';

// PBKDF2, а не password_hash: хеш создаётся скриптом на Node, а такой
// алгоритм одинаково считают и Node, и PHP. hash_equals сравнивает за
// постоянное время — по скорости ответа пароль подобрать нельзя.
// Длина 64: у hash_pbkdf2 это длина ГОТОВОЙ строки в hex-символах, а Node
// отдаёт 32 байта = те же 64 символа. С 32 сравнение не совпадало никогда.
function парольВерный($введённый) {
    if (!defined('ADMIN_HASH') || !defined('ADMIN_SALT') || !defined('ADMIN_ITER')) return false;
    $считанный = hash_pbkdf2('sha256', $введённый, ADMIN_SALT, ADMIN_ITER, 64, false);
    return hash_equals(ADMIN_HASH, $считанный);
}

if (!empty($_POST['password'])) {
    // Пауза против перебора: на живом человеке незаметна,
    // а скорость подбора режет на порядки.
    usleep(400000);
    if (парольВерный($_POST['password'])) {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        header('Location: ?');
        exit;
    }
    $ошибкаВхода = 'Неверный пароль';
}

$вошёл = !empty($_SESSION['admin']);

// Любое изменение данных требует токен из формы: без него чужая страница
// могла бы отправить запрос от имени залогиненного администратора.
function проверитьТокен() {
    if (empty($_POST['csrf']) || empty($_SESSION['csrf'])
        || !hash_equals($_SESSION['csrf'], $_POST['csrf'])) {
        http_response_code(400);
        exit('Неверный токен формы. Обновите страницу и попробуйте снова.');
    }
}

/* ─────────── Действия ─────────── */

$сообщение = '';

if ($вошёл && ($_SERVER['REQUEST_METHOD'] === 'POST') && !empty($_POST['действие'])) {
    проверитьТокен();
    $д = $_POST['действие'];

    if ($д === 'статья') {
        $посты = читатьJson(БЛОГ);
        $slug = trim($_POST['slug'] ?? '');
        // Адрес только латиницей: кириллица в ссылке превращается
        // в процентную кашу при копировании
        $slug = preg_replace('/[^a-z0-9-]/', '', strtolower($slug));
        if ($slug === '') $slug = 'post-' . time();

        $статья = [
            'slug'      => $slug,
            'title'     => trim($_POST['title'] ?? ''),
            'lead'      => trim($_POST['lead'] ?? ''),
            'body'      => trim($_POST['body'] ?? ''),
            'date'      => date('Y-m-d'),
            'dateHuman' => date('d.m.Y'),
        ];
        if ($статья['title'] === '') {
            $сообщение = 'Заголовок пустой — статья не сохранена';
        } else {
            // Правка существующей статьи, а не создание второй с тем же адресом
            $посты = array_values(array_filter($посты, fn($p) => ($p['slug'] ?? '') !== $slug));
            array_unshift($посты, $статья);
            $сообщение = писатьJson(БЛОГ, $посты)
                ? 'Статья сохранена: /blog/post.php?slug=' . $slug
                : 'Не удалось записать файл блога — проверьте права на папку data';
        }
    }

    if ($д === 'удалить-статью') {
        $slug = $_POST['slug'] ?? '';
        $посты = array_values(array_filter(читатьJson(БЛОГ), fn($p) => ($p['slug'] ?? '') !== $slug));
        $сообщение = писатьJson(БЛОГ, $посты) ? 'Статья удалена' : 'Не удалось записать файл';
    }

    if ($д === 'товар') {
        $правки = читатьJson(ПРАВКИ, []);
        $id = $_POST['id'] ?? '';
        if ($id !== '') {
            $запись = [];
            if (!empty($_POST['hidden'])) $запись['hidden'] = true;
            if (trim($_POST['price'] ?? '') !== '') $запись['price'] = trim($_POST['price']);
            if (trim($_POST['name'] ?? '') !== '') $запись['name'] = trim($_POST['name']);

            // Пустая запись — значит правок нет, и её надо убрать целиком,
            // иначе файл со временем зарастает пустышками
            if ($запись) $правки[$id] = $запись; else unset($правки[$id]);
            $сообщение = писатьJson(ПРАВКИ, $правки) ? 'Правки сохранены' : 'Не удалось записать файл';
        }
    }
}

/* ─────────── Данные для показа ─────────── */

$заявки = [];
if ($вошёл && is_file(ЗАЯВКИ)) {
    foreach (array_reverse(array_filter(explode("\n", (string) file_get_contents(ЗАЯВКИ)))) as $строка) {
        $з = json_decode($строка, true);
        if (is_array($з)) $заявки[] = $з;
        if (count($заявки) >= 200) break;
    }
}

$посты  = $вошёл ? читатьJson(БЛОГ) : [];
$правки = $вошёл ? читатьJson(ПРАВКИ, []) : [];
$товары = $вошёл ? читатьJson(ТОВАРЫ) : [];

$вкладка = $_GET['t'] ?? 'orders';
$поиск = trim($_GET['q'] ?? '');
if ($поиск !== '') {
    $товары = array_values(array_filter($товары,
        fn($t) => mb_stripos($t['name'] . ' ' . $t['category'], $поиск) !== false));
}
?><!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Админка — Атмосфера Мебель</title>
<style>
  :root { --bg:#F1E4D2; --surface:#FDF8F0; --primary:#2C2C2C; --secondary:#5C554C;
          --accent:#C4956A; --accent-text:#7D5228; --border:#DFCFB6; --green:#4A7C59; }
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
  .login { max-width: 340px; margin: 12vh auto; }
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
  .login-warn { margin-top: 18px; text-align: left; font-size: 13px; line-height: 1.55;
           background: #FBEEE9; border: 1px solid #E3B7AC; color: #8A2C1F;
           padding: 12px 14px; border-radius: 10px; }
  .login-warn code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px;
           font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  .login-foot { font-size: 12px; color: var(--secondary); opacity: .65; text-align: center; }
</style>
</head>
<body>
<div class="wrap">

<?php if (!$вошёл): ?>

  <div class="login">
    <div class="login-card">
      <img class="login-logo" src="../img/logo-mark.png"
           srcset="../img/logo-mark.png 1x, ../img/logo-mark@2x.png 2x"
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
        <?php if ($ошибкаВхода): ?>
          <p class="err" role="alert"><?= h($ошибкаВхода) ?></p>
        <?php endif; ?>
        <button type="submit" class="login-go">Войти</button>
      </form>

      <?php if (!defined('ADMIN_HASH')): ?>
        <div class="login-warn">
          <b>Пароль ещё не задан.</b>
          В <code>config.php</code> нет ADMIN_HASH / ADMIN_SALT / ADMIN_ITER,
          поэтому войти нельзя. Сгенерируйте их командой
          <code>node tools/admin-password.js «ваш-пароль»</code>
          и вставьте вывод в <code>config.php</code>.
        </div>
      <?php endif; ?>
    </div>

    <p class="login-foot">
      Служебная страница. Сессия закрывается при выходе из браузера.
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

<?php else: ?>

  <div class="top">
    <h1>Админка</h1>
    <span class="sp"></span>
    <a href="/" target="_blank">Открыть сайт ↗</a>
    <a href="?logout=1">Выйти</a>
  </div>

  <?php if ($сообщение): ?><div class="flash"><?= h($сообщение) ?></div><?php endif; ?>

  <div class="tabs">
    <a href="?t=orders" class="<?= $вкладка === 'orders' ? 'on' : '' ?>">Заявки (<?= count($заявки) ?>)</a>
    <a href="?t=blog"   class="<?= $вкладка === 'blog'   ? 'on' : '' ?>">Блог (<?= count($посты) ?>)</a>
    <a href="?t=goods"  class="<?= $вкладка === 'goods'  ? 'on' : '' ?>">Каталог</a>
  </div>

  <?php $csrf = h($_SESSION['csrf'] ?? ''); ?>

  <?php if ($вкладка === 'orders'): ?>

    <?php if (!$заявки): ?>
      <div class="card">
        <p>Заявок пока нет.</p>
        <p class="muted">Сюда попадает всё, что ушло в Telegram: заявки из корзины, с форм и планы комнат.
          Если Telegram недоступен, заявка не сохраняется — журнал ведётся только после успешной отправки.</p>
      </div>
    <?php else: foreach ($заявки as $з): ?>
      <div class="card">
        <div class="muted">
          <?= h(date('d.m.Y H:i', strtotime($з['at'] ?? ''))) ?>
          · <span class="chip"><?= h($з['kind'] ?? '?') ?></span>
          <?php if (!empty($з['phone'])): ?> · <a href="tel:<?= h($з['phone']) ?>"><?= h($з['phone']) ?></a><?php endif; ?>
        </div>
        <pre><?= h($з['text'] ?? '') ?></pre>
      </div>
    <?php endforeach; endif; ?>

  <?php elseif ($вкладка === 'blog'): ?>

    <h2>Новая статья</h2>
    <div class="card">
      <form method="post">
        <input type="hidden" name="csrf" value="<?= $csrf ?>">
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
    <?php if (!$посты): ?>
      <div class="card"><p class="muted">Пока ни одной. Три стартовые статьи вшиты в сайт и правятся в коде.</p></div>
    <?php else: foreach ($посты as $п): ?>
      <div class="card">
        <strong><?= h($п['title'] ?? '') ?></strong>
        <div class="muted"><?= h($п['dateHuman'] ?? '') ?> ·
          <a href="/blog/post.php?slug=<?= h($п['slug'] ?? '') ?>" target="_blank">открыть ↗</a></div>
        <p style="margin-top:6px;"><?= h($п['lead'] ?? '') ?></p>
        <form method="post" style="margin-top:10px;"
              onsubmit="return confirm('Удалить статью безвозвратно?')">
          <input type="hidden" name="csrf" value="<?= $csrf ?>">
          <input type="hidden" name="действие" value="удалить-статью">
          <input type="hidden" name="slug" value="<?= h($п['slug'] ?? '') ?>">
          <button class="danger" type="submit">Удалить</button>
        </form>
      </div>
    <?php endforeach; endif; ?>

  <?php else: ?>

    <h2>Каталог</h2>
    <div class="card">
      <p class="muted">
        Здесь можно скрыть товар с сайта, переименовать его или проставить цену.
        Правки применяются сразу, пересборка не нужна. Описания и фотографии
        задаются в коде — добавление новых товаров через админку не предусмотрено.
      </p>
      <form method="get" style="margin-top:12px;display:flex;gap:8px;">
        <input type="hidden" name="t" value="goods">
        <input name="q" value="<?= h($поиск) ?>" placeholder="Поиск по названию или разделу">
        <button type="submit">Найти</button>
      </form>
    </div>

    <table>
      <tr><th></th><th>Товар</th><th>Раздел</th><th>Скрыть</th><th>Название</th><th>Цена</th><th></th></tr>
      <?php foreach (array_slice($товары, 0, 200) as $т):
        $п = $правки[$т['id']] ?? []; ?>
        <tr>
          <td><img src="/<?= h($т['card']) ?>" alt="" loading="lazy"></td>
          <td>
            <a href="/product/<?= h($т['slug']) ?>/" target="_blank"><?= h($т['name']) ?></a>
            <?php if (!empty($п['hidden'])): ?><br><span class="chip">скрыт</span><?php endif; ?>
          </td>
          <td><?= h($т['category']) ?></td>
          <form method="post">
            <input type="hidden" name="csrf" value="<?= $csrf ?>">
            <input type="hidden" name="действие" value="товар">
            <input type="hidden" name="id" value="<?= h($т['id']) ?>">
            <td><input type="checkbox" name="hidden" value="1" style="width:auto"
                       <?= !empty($п['hidden']) ? 'checked' : '' ?>></td>
            <td><input name="name" value="<?= h($п['name'] ?? '') ?>" placeholder="<?= h($т['name']) ?>"></td>
            <td><input name="price" value="<?= h($п['price'] ?? '') ?>" placeholder="договорная"></td>
            <td><button type="submit">OK</button></td>
          </form>
        </tr>
      <?php endforeach; ?>
    </table>
    <?php if (count($товары) > 200): ?>
      <p class="muted" style="margin-top:12px;">Показаны первые 200 из <?= count($товары) ?> — уточните поиск.</p>
    <?php endif; ?>

  <?php endif; ?>

<?php endif; ?>

</div>
</body>
</html>
