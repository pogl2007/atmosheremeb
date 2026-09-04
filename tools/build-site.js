// Сборка статического сайта.
//
// На выходе — обычные HTML-файлы: никакого рендера во время запроса, поэтому
// сайт одинаково работает на любом хостинге, а поисковики видят готовую
// разметку, а не пустую страницу с одним скриптом.
//
// PHP остаётся только на приёме заявок и в админке — там он действительно нужен.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SITE = path.join(ROOT, 'site');

const каталог = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));
const посты = require(path.join(SITE, 'blog-posts.js'));
const { КОНТАКТЫ, частиДляPHP, ВЕРСИИ } = require(path.join(SITE, 'layout.js'));
const P = require(path.join(SITE, 'pages.js'));
const P2 = require(path.join(SITE, 'pages2.js'));
const P3 = require(path.join(SITE, 'pages3.js'));

let файлов = 0, байт = 0;
const адреса = [];

function записать(маршрут, html) {
  // Каждая страница — index.html в своей папке: адреса получаются без
  // расширения и с завершающим слэшем, канонично для поиска.
  const dir = маршрут === '/' ? PUB : path.join(PUB, маршрут.replace(/^\/|\/$/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  const файл = path.join(dir, 'index.html');
  fs.writeFileSync(файл, html, 'utf8');
  файлов++; байт += Buffer.byteLength(html);
  адреса.push(маршрут);
}

/* ── Скрипты ── */

// Короткий отпечаток содержимого — он же метка версии в адресе файла.
// Не изменился файл — не изменился адрес, браузер берёт его из кэша.
function метка(содержимое) {
  return crypto.createHash('md5').update(содержимое).digest('hex').slice(0, 8);
}

function собратьСтили() {
  const читать = f => fs.readFileSync(path.join(SITE, f), 'utf8');
  fs.mkdirSync(path.join(PUB, 'assets'), { recursive: true });

  // extracted.css — стили прежней одностраничной версии; они и есть
  // дизайн-система, поэтому берутся как основа, а не переписываются заново.
  const css = [
    '/* Собрано tools/build-site.js — правьте исходники в site/, а не этот файл. */',
    читать('extracted.css').replace(/^ {4}/gm, ''),
    читать('components.css'),
    читать('layout-extra.css'),
    читать('dark.css'),
    читать('contrast.css'),
    читать('nav.css'),
    читать('logo.css'),
  ].join('\n');

  fs.writeFileSync(path.join(PUB, 'assets', 'site.css'), css, 'utf8');
  ВЕРСИИ.css = метка(css);

  const o = (css.match(/{/g) || []).length, c = (css.match(/}/g) || []).length;
  if (o !== c) console.log(`  ВНИМАНИЕ: в стилях ${o} «{» и ${c} «}» — где-то потеряна скобка`);
  return Buffer.byteLength(css);
}

function собратьСкрипты() {
  const читать = f => fs.readFileSync(path.join(SITE, f), 'utf8');
  fs.mkdirSync(path.join(PUB, 'assets'), { recursive: true });

  // Общий бандл: ядро, консультант и слайдер. Слайдер внутри уже проверяет,
  // есть ли он на странице, поэтому лишним не мешает.
  const site = [
    '// Собрано tools/build-site.js — правьте исходники в site/, а не этот файл.',
    читать('core.js'),
    читать('hero-slider.js'),
    читать('consultant.js'),
    читать('slider.js'),
  ].join('\n\n');
  fs.writeFileSync(path.join(PUB, 'assets', 'site.js'), site, 'utf8');
  ВЕРСИИ.js = метка(site);

  // Планировщик вешает обработчики на свою разметку сразу при загрузке,
  // без проверок, поэтому его нельзя класть в общий бандл — на остальных
  // страницах он падал бы на отсутствующем элементе.
  const planner = [
    '// Собрано tools/build-site.js — грузится только на /planner/.',
    читать('planner-core.js'),
    читать('planner-page.js'),
  ].join('\n\n');
  fs.writeFileSync(path.join(PUB, 'assets', 'planner.js'), planner, 'utf8');
  ВЕРСИИ.planner = метка(planner);

  return {
    site: Buffer.byteLength(site),
    planner: Buffer.byteLength(planner),
  };
}

/* ── Тексты страниц категорий ── */

const КАТЕГОРИЙНЫЕ = {
  'Кухни': {
    url: '/kitchens/', active: 'kitchens',
    h1: 'Кухни на заказ',
    title: 'Кухни на заказ по вашим размерам | Атмосфера Мебель',
    description: 'Кухни на заказ: прямые, угловые, П-образные, с островом и барной стойкой. Изготовление по размерам помещения за 7–14 дней, бесплатный замер и проект.',
    lead: 'Прямые, угловые, П-образные, с островом и барной стойкой. Любую модель пересчитываем под ваши стены, окно и коммуникации.',
    body: `
      <h2>Как подобрать кухню</h2>
      <p>Планировку определяет не вкус, а геометрия комнаты и то, где уже стоят вода, газ и вентиляция. Узкое помещение почти всегда приводит к прямой кухне, комната от 6 м² допускает угловую, а остров требует 15–16 м² и прохода не меньше 90 см со всех сторон.</p>
      <p>Мы не делаем кухню «по картинке»: сначала смотрим размеры и то, что переносить нельзя, а потом подбираем модель, которая в эти условия укладывается. Наполнение, фурнитура и цвет фасадов обсуждаются отдельно.</p>
      <h2>Сколько стоит</h2>
      <p>Цена кухни складывается из длины фронта, материала фасадов, наполнения и техники. Разброс настолько велик, что цифра «от» вводила бы в заблуждение, поэтому мы считаем стоимость под конкретный проект и называем её до начала работ.</p>
      <p><a href="/blog/kak-vybrat-planirovku-kuhni/">Подробный разбор планировок — в блоге</a>.</p>`,
  },
  'Гостиные': {
    url: '/living/', active: 'living',
    h1: 'Мебель для гостиной',
    title: 'Мебель для гостиной на заказ | Атмосфера Мебель',
    description: 'ТВ-зоны, стеллажи и системы хранения для гостиной на заказ. Изготовление по размерам стены, бесплатный замер и дизайн-проект.',
    lead: 'ТВ-зоны, встроенные стеллажи и закрытое хранение. Собираем стену целиком, а не подбираем отдельные тумбы, которые не стыкуются между собой.',
    body: `
      <h2>Что обычно заказывают</h2>
      <p>Чаще всего гостиная — это одна стена, на которой нужно уместить телевизор, технику, книги и то, что не должно быть на виду. Готовые гарнитуры редко попадают в размер: остаются щели по краям или мебель не достаёт до потолка.</p>
      <p>Мебель по размеру решает это иначе — корпус идёт от стены до стены, а верхний ярус можно поднять до потолка, чтобы наверху не собиралась пыль.</p>
      <h2>Подсветка и ниши</h2>
      <p>Подсветку закладывают до изготовления: под неё нужен паз в корпусе и вывод питания в нужной точке. Добавить её потом можно, но аккуратно спрятать провод уже не получится.</p>`,
  },
};

/* ── Сборка ── */

console.log('Сборка сайта\n');

const размерCss = собратьСтили();
const размерыСкриптов = собратьСкрипты();

записать('/', P.главная(каталог));
записать('/catalog/', P.каталогСтраница(каталог));

for (const категория of каталог.categories) {
  const тексты = КАТЕГОРИЙНЫЕ[категория.name];
  if (!тексты) continue;                      // у остальных разделов своей страницы нет
  записать(тексты.url, P.категорияСтраница(каталог, категория, тексты));
}

for (const p of каталог.products) {
  записать(`/product/${p.slug}/`, P.товарСтраница(каталог, p));
}

записать('/cart/', P2.корзина(каталог));
записать('/about/', P2.оКомпании(каталог));
записать('/contacts/', P2.контакты(каталог));
// Планировщик отложен по просьбе заказчика. Код цел (site/pages3.js,
// site/planner-*.js) — чтобы вернуть, достаточно раскомментировать строку.
// записать('/planner/', P3.планировщик(каталог));
записать('/blog/', P2.блогСписок(каталог, посты));
for (const пост of посты) записать(`/blog/${пост.slug}/`, P2.блогПост(каталог, пост));

// 404 отдаётся Apache напрямую по пути из .htaccess, поэтому это
// единственная страница-файл, а не папка с index.html
fs.writeFileSync(path.join(PUB, '404.html'), P2.ненайдено(каталог), 'utf8');

/* ── Каркас для страниц, которые собирает бекенд ── */

// Статьи, добавленные через админку, рисует служба atmosfera: она берёт
// эти шапку и подвал и вставляет между ними текст. Так вся вёрстка остаётся
// в сборке, а в бекенде её нет вовсе — и оформление не расходится.
const части = частиДляPHP(каталог.categories);
fs.mkdirSync(path.join(PUB, 'inc'), { recursive: true });
fs.writeFileSync(path.join(PUB, 'inc', 'header.html'), части.шапка, 'utf8');
fs.writeFileSync(path.join(PUB, 'inc', 'footer.html'), части.подвал, 'utf8');

/* ── Данные для бекенда ── */

// Лежат отдельно от public намеренно: это не то, что раздаёт веб-сервер,
// а то, что читает служба. Раньше они лежали внутри раздаваемой папки,
// и от посетителей их закрывали правилами в конфиге nginx — то есть
// безопасность держалась на том, что в конфиге не ошиблись.
// При выкладке папка уезжает в /var/lib/atmosfera.
const ДАННЫЕ = path.join(ROOT, 'build-data');
fs.mkdirSync(ДАННЫЕ, { recursive: true });

// Промпт ИИ-консультанта. Кладём файлом, а не вписываем в код: так факты
// о компании берутся из site/facts.js и гарантированно совпадают с текстами
// сайта, чего не было, когда промпт дублировался руками.
fs.writeFileSync(path.join(ДАННЫЕ, 'ai-prompt.txt'),
  require(path.join(SITE, 'ai-prompt.js')).собратьПромпт(), 'utf8');

// Пустые заготовки под то, что пишет админка. Создаются только если файла
// ещё нет: перезаписать их сборкой значило бы стереть правки заказчика.
for (const [имя, пусто] of [['overrides.json', '{}'], ['blog.json', '[]']]) {
  const п = path.join(ДАННЫЕ, имя);
  if (!fs.existsSync(п)) fs.writeFileSync(п, пусто, 'utf8');
}

// Список товаров для админки: только то, что ей нужно показать в таблице,
// без описаний и галерей — иначе страница админки весила бы под мегабайт.
fs.writeFileSync(path.join(ДАННЫЕ, 'admin-products.json'),
  JSON.stringify(каталог.products.map(p => ({
    id: p.id, slug: p.slug, name: p.name, category: p.category, card: p.photos[0].card,
  }))), 'utf8');

/* ── robots и карта сайта ── */

// Заявка и админка в индекс не идут
const вКарту = адреса.filter(u => u !== '/cart/' && !u.startsWith('/admin'));
const дата = new Date().toISOString().slice(0, 10);
const карта = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${вКарту.map(u => `  <url>
    <loc>${КОНТАКТЫ.site}${u}</loc>
    <lastmod>${дата}</lastmod>
    <priority>${u === '/' ? '1.0' : u.startsWith('/product/') ? '0.7' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`.replace('www.sitemap.org', 'www.sitemaps.org');
fs.writeFileSync(path.join(PUB, 'sitemap.xml'), карта, 'utf8');

fs.writeFileSync(path.join(PUB, 'robots.txt'),
`User-agent: *
Allow: /

# Иконка и превью обязаны быть доступны роботам, иначе логотип
# не появится рядом со ссылкой в выдаче
Allow: /favicon.ico
Allow: /og-image.jpg

Disallow: /api/
Disallow: /admin/
Disallow: /cart/
Disallow: /config.php

Sitemap: ${КОНТАКТЫ.site}/sitemap.xml
`, 'utf8');

/* ── Отчёт ── */

const поРазделам = {};
адреса.forEach(u => {
  const k = u === '/' ? 'главная'
    : u.startsWith('/product/') ? 'карточки товаров'
    : u.startsWith('/blog/') && u !== '/blog/' ? 'статьи блога'
    : 'разделы';
  поРазделам[k] = (поРазделам[k] || 0) + 1;
});

Object.entries(поРазделам).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));
console.log(`\nСтраниц: ${файлов}, суммарно ${(байт / 1048576).toFixed(2)} МБ`);
console.log(`site.css: ${(размерCss/1024).toFixed(0)} КБ`);
console.log(`site.js: ${(размерыСкриптов.site / 1024).toFixed(0)} КБ, planner.js: ${(размерыСкриптов.planner / 1024).toFixed(0)} КБ`);
console.log(`В карте сайта: ${вКарту.length} адресов`);
