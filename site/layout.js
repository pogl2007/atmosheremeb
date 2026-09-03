// Общий каркас страниц: head, шапка, подвал, виджет консультанта.
//
// Сайт собирается статически, поэтому шапка и подвал не «подключаются»
// во время запроса, а вклеиваются в каждый файл на сборке. Значит, любая
// правка здесь требует пересборки — зато на хостинге не нужен ни PHP,
// ни рендер на лету.

// Знак логотипа. Вектора нет — исходники растровые, поэтому кладём PNG
// с прозрачным фоном и удвоенной версией под плотные экраны.
//
// Вариантов два: на светлом фоне знак тёмно-синий с золотом, а на шоколадном
// синий контур почти сливается, поэтому там идёт золотой. Переключаются
// стилями по классу nav.over-dark, без скриптов.
const ЛОГО_ЗНАК = () => `
      <span class="logo-mark">
        <img class="lm-light" src="/img/logo-mark.png" srcset="/img/logo-mark@2x.png 2x"
             width="48" height="40" alt="" aria-hidden="true">
        <img class="lm-dark" src="/img/logo-mark-light.png" srcset="/img/logo-mark-light@2x.png 2x"
             width="49" height="40" alt="" aria-hidden="true">
      </span>`;

// В подвале фон всегда тёмный — там нужен только золотой вариант
const ЛОГО_ЗНАК_ТЁМНЫЙ = () => `
      <img class="footer-mark" src="/img/logo-mark-light.png" srcset="/img/logo-mark-light@2x.png 2x"
           width="49" height="40" alt="" aria-hidden="true">`;

// Пункты меню. active — какой подсветить; сравнение по ключу, а не по адресу,
// чтобы карточка товара подсвечивала «Каталог».
//
// В строке остаются только два самых ходовых раздела — кухни и шкафы.
// Остальные типы прячутся в выпадающий список под «Каталогом»: их семь,
// и в строку они не помещаются, начиная переноситься на второй ряд.
const МЕНЮ = [
  { key: 'catalog', href: '/catalog/', label: 'Каталог', выпадающий: true },
  { key: 'kitchens', href: '/kitchens/', label: 'Кухни' },
  { key: 'wardrobes', href: '/catalog/?cat=' + encodeURIComponent('Шкафы и гардеробные'),
    label: 'Шкафы и гардеробные' },
  { key: 'blog', href: '/blog/', label: 'Блог' },
  { key: 'about', href: '/about/', label: 'О компании' },
  { key: 'contacts', href: '/contacts/', label: 'Контакты' },
];

// У разделов с собственной страницей ссылка ведёт туда, у остальных —
// в каталог с заранее выбранным фильтром.
const СВОЯ_СТРАНИЦА = { 'Кухни': '/kitchens/', 'Гостиные': '/living/' };
const адресРаздела = имя => СВОЯ_СТРАНИЦА[имя] || '/catalog/?cat=' + encodeURIComponent(имя);

const КОНТАКТЫ = require('./contacts.js');

function head({ title, description, canonical, ogImage }) {
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${КОНТАКТЫ.site}${canonical}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Атмосфера Мебель">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${КОНТАКТЫ.site}${canonical}">
<meta property="og:image" content="${КОНТАКТЫ.site}/${ogImage || 'og-image.jpg'}">

<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<!-- 192 и 48 — для поисковиков: Google берёт иконку в размере, кратном 48,
     и 32-пиксельной ему мало. Без этой строки в выдаче окажется мелкий кадр. -->
<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#2D231B">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">`;
}

function nav(active, категории = []) {
  const разделы = категории.map(c =>
    `<a href="${адресРаздела(c.name)}">${c.name}<span class="n">${c.count}</span></a>`).join('\n        ');

  const links = МЕНЮ.map(m => {
    const текущий = m.key === active ? ' on' : '';
    if (!m.выпадающий) return `<a href="${m.href}" class="nav-link${текущий}">${m.label}</a>`;
    // Кнопка, а не ссылка: по клику раскрывает список, а не уводит со страницы.
    // Сам «Каталог» доступен первым пунктом внутри списка.
    return `<div class="nav-drop">
        <button type="button" class="nav-link${текущий}" aria-expanded="false"
                aria-controls="navDropMenu" onclick="toggleCatalogMenu(this)">
          ${m.label}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="nav-drop-menu" id="navDropMenu" hidden>
          <a href="/catalog/" class="all">Весь каталог</a>
          ${разделы}
        </div>
      </div>`;
  }).join('\n      ');

  const mobile = [
    `<a href="/catalog/" onclick="toggleMobileMenu()">Весь каталог</a>`,
    ...категории.map(c => `<a href="${адресРаздела(c.name)}" class="sub" onclick="toggleMobileMenu()">${c.name}<span class="n">${c.count}</span></a>`),
    ...МЕНЮ.filter(m => !m.выпадающий && m.key !== 'kitchens' && m.key !== 'wardrobes')
      .map(m => `<a href="${m.href}" onclick="toggleMobileMenu()">${m.label}</a>`),
  ].join('\n    ');

  return `<nav id="navbar">
  <div class="nav-inner">
    <a href="/" class="logo" aria-label="Атмосфера Мебель — на главную">${ЛОГО_ЗНАК()}
      <span class="logo-text">
        <span class="logo-main">Атмосфера</span>
        <span class="logo-sub">Мебель</span>
      </span>
    </a>
    <div class="nav-links">
      ${links}
    </div>
    <div class="nav-right">
      <a href="/cart/" class="nav-cta cart-link" aria-label="Корзина">
        Корзина <span class="cart-count" aria-hidden="true">0</span>
      </a>
      <div class="hamburger" onclick="toggleMobileMenu()" aria-label="Меню">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>
  <div class="mobile-menu" id="mobileMenu">
    ${mobile}
    <a href="/cart/" class="nav-cta" style="width:100%;margin-top:8px;text-align:center;">
      Корзина <span class="cart-count" aria-hidden="true">0</span>
    </a>
  </div>
</nav>`;
}

function footer(категории) {
  const катСсылки = категории.map(c =>
    `<a href="/catalog/?cat=${encodeURIComponent(c.name)}">${c.name}</a>`).join('\n        ');

  return `<footer>
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">${ЛОГО_ЗНАК_ТЁМНЫЙ()}
        <span class="logo-main">Атмосфера</span>
        <span class="logo-sub">Мебель</span>
        <p>Кухни, шкафы и гардеробные на заказ по вашим размерам. Выездной шоу-рум: дизайнер приедет с образцами, замер и проект бесплатно.</p>
      </div>
      <div class="footer-col">
        <h4>Каталог</h4>
        ${катСсылки}
      </div>
      <div class="footer-col">
        <h4>Компания</h4>
        <a href="/about/">О компании</a>
        <a href="/blog/">Блог</a>
        <a href="/contacts/">Контакты</a>
        <a href="/cart/">Корзина</a>
      </div>
      ${КОНТАКТЫ.тестовыйРежим ? '' : `
      <div class="footer-col">
        <h4>Контакты</h4>
        <a href="tel:${КОНТАКТЫ.phoneHref}">${КОНТАКТЫ.phone}</a>
        <a href="mailto:${КОНТАКТЫ.email}">${КОНТАКТЫ.email}</a>
      </div>`}
    </div>
    <div class="footer-bottom">
      <p>© ${new Date().getFullYear()} Атмосфера Мебель</p>
      <p>${КОНТАКТЫ.тестовыйРежим ? КОНТАКТЫ.надписьТест : КОНТАКТЫ.legalShort}</p>
    </div>
  </div>
</footer>`;
}

// Виджет консультанта одинаков на всех страницах
const консультант = `
<div class="cbubble" id="cbubble">
  <div class="cbubble-label" id="cbubbleLabel" onclick="openChat()">Сообщение от консультанта</div>
  <button class="cbubble-btn" onclick="openChat()" aria-label="Открыть чат с консультантом">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
    <span class="cbubble-dot" id="cbubbleDot"></span>
  </button>
</div>

<div class="cpanel" id="cpanel" role="dialog" aria-label="Чат с консультантом">
  <div class="cpanel-head">
    <div class="cpanel-ava">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
    </div>
    <div>
      <div class="cpanel-title">Консультант «Атмосфера Мебель»</div>
      <div class="cpanel-sub">На связи</div>
    </div>
    <button class="cpanel-close" onclick="closeChat()" aria-label="Закрыть">×</button>
  </div>
  <div class="cpanel-body" id="cbody"></div>
  <div class="cpanel-chips" id="cchips"></div>
  <form class="cpanel-foot" id="cform" onsubmit="sendChat(event)">
    <input id="cinput" type="text" placeholder="Спросите о мебели…" autocomplete="off">
    <button class="cpanel-send" type="submit" id="csend" aria-label="Отправить">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
    </button>
  </form>
  <div class="cpanel-note">Отвечает ИИ-помощник. Точную стоимость назовёт менеджер.</div>
</div>`;

// Разметка товаров и категорий для поисковиков
function schemaOrg(объект) {
  return `<script type="application/ld+json">${JSON.stringify(объект)}</script>`;
}

function page({ title, description, canonical, active, ogImage, body, категории, extraHead = '', extraBody = '' }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
${head({ title, description, canonical, ogImage })}
${extraHead}
</head>
<body>
${nav(active, категории)}
${body}
${footer(категории)}
${консультант}
${extraBody}
<script src="/assets/site.js"></script>
</body>
</html>`;
}

// Куски каркаса для PHP-страниц (статьи, добавленные через админку).
// Идея простая: всю вёрстку готовит сборка, а PHP остаётся только склеить
// шапку, содержимое и подвал. Так в PHP нет ни шаблонов, ни логики вывода —
// значит, и ломаться там почти нечему.
//
// {{TITLE}} и {{DESCRIPTION}} подставляет PHP, экранируя значения.
function частиДляPHP(категории) {
  const шапка = `<!DOCTYPE html>
<html lang="ru">
<head>
${head({ title: '{{TITLE}}', description: '{{DESCRIPTION}}', canonical: '{{CANONICAL}}' })}
</head>
<body>
${nav('blog', категории)}
`;
  const подвал = `${footer(категории)}
${консультант}
<script src="/assets/site.js"></script>
</body>
</html>
`;
  return { шапка, подвал };
}

module.exports = {
  page, nav, footer, head, schemaOrg, частиДляPHP, МЕНЮ, КОНТАКТЫ };
