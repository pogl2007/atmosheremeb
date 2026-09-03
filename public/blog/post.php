<?php
// Статья, добавленная через админку.
//
// Три стартовые статьи собраны в статические страницы (/blog/<адрес>/) —
// им PHP не нужен. Этот файл обслуживает только то, что появилось позже:
// читает data/blog.json и вставляет статью в готовый каркас, который
// сборка положила в /inc. Никаких шаблонов здесь нет намеренно —
// чем меньше логики в PHP, тем меньше в нём может сломаться.

$slug = $_GET['slug'] ?? '';
// Адрес приходит из запроса — режем всё, кроме латиницы, цифр и дефиса,
// иначе он мог бы увести чтение файла в чужую папку
$slug = preg_replace('/[^a-z0-9-]/', '', strtolower((string) $slug));

$посты = [];
$файл = __DIR__ . '/../data/blog.json';
if (is_file($файл)) {
    $d = json_decode((string) file_get_contents($файл), true);
    if (is_array($d)) $посты = $d;
}

$статья = null;
foreach ($посты as $п) {
    if (($п['slug'] ?? '') === $slug) { $статья = $п; break; }
}

if (!$статья) {
    http_response_code(404);
    $статья = [
        'title'     => 'Статья не найдена',
        'lead'      => 'Возможно, её удалили или адрес указан с опечаткой.',
        'dateHuman' => '',
        'body'      => '<p>Вернитесь к <a href="/blog/">списку статей</a> — там всё, что опубликовано.</p>',
    ];
}

function э($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

$заголовок = э($статья['title']) . ' | Атмосфера Мебель';
$описание = э($статья['lead'] ?? '');
$адрес = '/blog/post.php?slug=' . э($slug);

$шапка = (string) file_get_contents(__DIR__ . '/../inc/header.html');
$шапка = str_replace(
    ['{{TITLE}}', '{{DESCRIPTION}}', '{{CANONICAL}}'],
    [$заголовок, $описание, $адрес],
    $шапка
);

echo $шапка;
?>
<div class="container">
  <nav class="crumbs">
    <a href="/">Главная</a><span>/</span><a href="/blog/">Блог</a><span>/</span><?= э($статья['title']) ?>
  </nav>
  <article class="article">
    <?php if (!empty($статья['dateHuman'])): ?>
      <span class="post-date"><?= э($статья['dateHuman']) ?></span>
    <?php endif; ?>
    <h1><?= э($статья['title']) ?></h1>
    <?php
      // Текст пишет владелец сайта через админку, за паролем. Разметку
      // оставляем, но только безопасный набор тегов: чтобы случайно
      // вставленный из интернета кусок не притащил на страницу скрипт.
      echo strip_tags($статья['body'] ?? '', '<p><h2><h3><ul><ol><li><b><strong><i><em><a><br><blockquote>');
    ?>
    <p style="margin-top:34px;"><a href="/catalog/" class="btn btn-primary">Посмотреть каталог</a></p>
  </article>
</div>
<?php
echo (string) file_get_contents(__DIR__ . '/../inc/footer.html');
