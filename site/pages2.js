// Страницы без каталога: заявка, о компании, контакты, блог, планировщик.

const { page, КОНТАКТЫ } = require('./layout.js');
const { esc, формаЗаявки } = require('./pages.js');
const Ф = require('./facts.js');

/* ─────────── Корзина-заявка ─────────── */

function корзина(каталог) {
  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span>Корзина</nav>
  <div class="page-head">
    <h1 id="cartHeading">Корзина</h1>
    <p>Это не оформление заказа и не оплата. Вы показываете, что вам понравилось, — дальше приедет дизайнер с образцами, сделает замер и рассчитает стоимость.</p>
  </div>

  <div class="empty" id="cartEmpty" hidden>
    <h3>Корзина пуста</h3>
    <p>Загляните в каталог и добавьте то, что приглянулось.</p>
    <p style="margin-top:18px;"><a href="/catalog/" class="btn btn-primary">Перейти в каталог</a></p>
  </div>

  <div class="empty" id="cartDone" hidden>
    <h3>Заявка отправлена</h3>
    <p>Мы получили список и свяжемся с вами удобным способом.</p>
    <p style="margin-top:18px;"><a href="/catalog/" class="btn btn-ghost">Вернуться в каталог</a></p>
  </div>

  <div class="cart-layout" id="cartLayout" hidden>
    <div id="cartList"></div>

    <form class="cart-form" id="cartForm">
      <h3>Как с вами связаться</h3>
      <p class="hint">Свяжемся и договоримся о выезде дизайнера: он привезёт образцы, сделает замер и рассчитает стоимость. Замер и проект бесплатные.</p>
      <div class="field">
        <label for="c-name">Как к вам обращаться</label>
        <input id="c-name" name="name" type="text" autocomplete="name" placeholder="Имя">
        <div class="err">Напишите имя</div>
      </div>
      <div class="field">
        <label for="c-phone">Телефон</label>
        <input id="c-phone" name="phone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00">
        <div class="err">Нужен номер из 10 цифр</div>
      </div>
      <div class="field">
        <label for="c-contact">Где удобнее общаться</label>
        <select id="c-contact" name="contact">
          <option value="call">Звонок</option>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="max">Max</option>
        </select>
      </div>
      <div class="hp" aria-hidden="true">
        <label>Не заполняйте это поле<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Отправить заявку</button>
      <p class="product-note">Нажимая кнопку, вы соглашаетесь на обработку персональных данных.</p>
    </form>
  </div>
</div>`;

  return page({
    title: 'Корзина | Атмосфера Мебель',
    description: 'Выбранные модели. Оставьте контакты — дизайнер приедет с образцами и рассчитает стоимость.',
    canonical: '/cart/', active: 'cart', категории: каталог.categories, body,
    extraHead: '<meta name="robots" content="noindex">',
  });
}

/* ─────────── О компании ─────────── */

function оКомпании(каталог) {
  const всего = каталог.products.length;
  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span>О компании</nav>
  <div class="article">
    <h1>Мебель, которая подходит идеально</h1>

    <p>Мы делаем всё сами: замер, дизайн-проект, доставку и сборку. Вам остаётся только выбрать — и для этого даже не нужно выходить из дома. Приедем с образцами, покажем материалы вживую и рассчитаем стоимость. Работа напрямую от производителя позволяет держать цены ниже, чем в салонах, без потери качества.</p>

    <h2>Выездной шоу-рум</h2>
    <p>Стационарного салона у нас нет, и это не недостаток, а формат работы. Вместо того чтобы звать вас в торговый зал, мы привозим зал к вам: ${Ф.выезд.toLowerCase()}. Дизайнер приезжает ${Ф.выездСрок} — вы смотрите фасады и фурнитуру там же, где будет стоять мебель, при вашем освещении.</p>
    <p>Замер и дизайн-проект бесплатные. Мы берём их на себя до того, как вы что-либо оплачиваете.</p>

    <h2>Производство</h2>
    <p>Собственное производство находится в ${Ф.производство}е. Мебель изготавливается по размерам конкретного помещения, а не подбирается из готовых габаритов со склада. Срок изготовления — ${Ф.срокИзготовления}.</p>
    <p>В каталоге ${всего} моделей. Каждую адаптируем под ваши стены, ниши, окна и высоту потолка; размеры, наполнение и цвет обсуждаются до начала работ.</p>

    <h2>Цена</h2>
    <p>Мы не публикуем цены в каталоге, и на это есть причина. Стоимость корпусной мебели складывается из погонного метра, материала фасадов, наполнения, фурнитуры и техники — набор отличается настолько, что любая цифра «от» вводила бы в заблуждение. Поэтому цена ${Ф.ценаПояснение}.</p>
    <p>В стоимость уже включены ${Ф.входитВСтоимость.map(с => с[0].toLowerCase() + с.slice(1)).join(', ')}. ${Ф.безСкрытыхДоплат} ${Ф.сборкаОтдельно}</p>
    <p>Предоплата — ${Ф.предоплата}. Всё существенное фиксируется в договоре: цвет, материалы, комплектация, сроки и стоимость.</p>

    <h2>Гарантия</h2>
    <p>${Ф.гарантия} ${Ф.гарантияНаЧто}.</p>

    <h2>География</h2>
    <p>Производство в ${Ф.производство}, работаем в трёх регионах: ${Ф.основныеРегионы.join(', ')}. В каждом — выезд дизайнера с образцами и доставка. За пределы этих регионов пока не возим.</p>

    <h2>Что дальше</h2>
    <p>Соберите заявку из каталога или просто оставьте номер — мы свяжемся и договоримся о выезде дизайнера. Заявка ни к чему не обязывает.</p>

    <p style="margin-top:26px;">
      <a href="/catalog/" class="btn btn-primary">Смотреть каталог</a>
      <a href="/contacts/" class="btn btn-ghost">Контакты</a>
    </p>
  </div>
</div>`;

  return page({
    title: 'О компании — выездной шоу-рум мебели | Атмосфера Мебель',
    description: 'Корпусная мебель на заказ по размерам помещения. Выездной шоу-рум, бесплатный замер и проект, собственное производство.',
    canonical: '/about/', active: 'about', категории: каталог.categories, body,
  });
}

/* ─────────── Контакты ─────────── */

function контакты(каталог) {
  const К = КОНТАКТЫ;
  const мб = (v, stub) => stub ? `<span class="stub">${esc(v)}</span>` : esc(v);

  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span>Контакты</nav>
  <div class="page-head">
    <h1>Контакты</h1>
    <p>Дизайнер приедет к вам с образцами материалов — замер и проект бесплатные.${
      К.тестовыйРежим ? ' Оставьте заявку, и мы свяжемся с вами.'
                      : ' Напишите или позвоните, договоримся о времени.'}</p>
  </div>

  <div class="contact-grid">
    <div>
      ${К.тестовыйРежим ? `
      <div class="test-note">
        <b>${esc(К.надписьТест)}</b>
        <p>${esc(К.поясненияТест)}</p>
        <p>Пока связаться можно только через форму справа — она работает,
           заявка дойдёт.</p>
      </div>

      <dl class="contact-list">
        <div><dt>Регионы работы</dt><dd>${Ф.основныеРегионы.join(', ')}</dd></div>
      </dl>` : `
      <dl class="contact-list">
        <div><dt>Телефон</dt><dd><a href="tel:${esc(К.phoneHref)}">${esc(К.phone)}</a></dd></div>
        <div><dt>Почта</dt><dd><a href="mailto:${esc(К.email)}">${esc(К.email)}</a></dd></div>
        <div><dt>Telegram</dt><dd>${esc(К.telegram.replace('https://t.me/', '@'))}</dd></div>
        <div><dt>WhatsApp</dt><dd>${esc(К.phone)}</dd></div>
        <div><dt>Время работы</dt><dd>${esc(К.hours)}</dd></div>
        <div><dt>Регионы работы</dt><dd>${Ф.основныеРегионы.join(', ')}</dd></div>
      </dl>

      <h2 style="font-family:var(--font-d);font-size:24px;margin:30px 0 12px;">Реквизиты</h2>
      <p class="req">
        <b>${esc(К.legalName)}</b><br>
        ИНН ${esc(К.inn)}<br>
        ОГРНИП ${esc(К.ogrnip)}<br>
        Адрес: ${esc(К.address)}<br>
        Банк: ${esc(К.bank)}<br>
        Расчётный счёт: ${esc(К.account)}
      </p>`}
    </div>

    <div>
      ${формаЗаявки('заявка со страницы контактов')}
    </div>
  </div>
</div>`;

  return page({
    title: 'Контакты | Атмосфера Мебель',
    description: 'Телефон, почта и мессенджеры. Выездной шоу-рум: дизайнер приедет с образцами, замер и проект бесплатно.',
    canonical: '/contacts/', active: 'contacts', категории: каталог.categories, body,
  });
}

/* ─────────── Блог ─────────── */

function блогСписок(каталог, посты) {
  const карточки = посты.map(p => `
    <a class="post-card" href="/blog/${p.slug}/">
      <span class="post-date">${esc(p.dateHuman)}</span>
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.lead)}</p>
      <span class="more">Читать →</span>
    </a>`).join('');

  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span>Блог</nav>
  <div class="page-head">
    <h1>Блог</h1>
    <p>Разбираем то, о чём чаще всего спрашивают перед заказом: размеры, материалы, планировки и подводные камни.</p>
  </div>
  <div class="posts">${карточки}</div>
  <div style="height:60px"></div>
</div>`;

  return page({
    title: 'Блог о мебели на заказ | Атмосфера Мебель',
    description: 'Статьи о выборе кухни, шкафа и гардеробной: размеры, материалы, планировки, частые ошибки.',
    canonical: '/blog/', active: 'blog', категории: каталог.categories, body,
  });
}

function блогПост(каталог, пост) {
  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span><a href="/blog/">Блог</a><span>/</span>${esc(пост.title)}</nav>
  <article class="article">
    <span class="post-date">${esc(пост.dateHuman)}</span>
    <h1>${esc(пост.title)}</h1>
    ${пост.body}
    <p style="margin-top:34px;">
      <a href="/catalog/" class="btn btn-primary">Посмотреть каталог</a>
    </p>
  </article>
</div>`;

  return page({
    title: `${пост.title} | Атмосфера Мебель`,
    description: пост.lead,
    canonical: `/blog/${пост.slug}/`, active: 'blog',
    категории: каталог.categories, body,
    extraHead: `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: пост.title, description: пост.lead, datePublished: пост.date,
      author: { '@type': 'Organization', name: 'Атмосфера Мебель' },
    })}</script>`,
  });
}

module.exports = { корзина, оКомпании, контакты, блогСписок, блогПост };

/* ─────────── 404 ─────────── */

function ненайдено(каталог) {
  const body = `
<div class="container">
  <div class="empty" style="padding:90px 20px;">
    <h1 style="font-family:var(--font-d);font-size:36px;">Страница не найдена</h1>
    <p>Возможно, её удалили или в адресе опечатка.</p>
    <p style="margin-top:22px;">
      <a href="/" class="btn btn-primary">На главную</a>
      <a href="/catalog/" class="btn btn-ghost">В каталог</a>
    </p>
  </div>
</div>`;

  return page({
    title: 'Страница не найдена | Атмосфера Мебель',
    description: 'Запрошенная страница не найдена.',
    canonical: '/404.html', active: '', категории: каталог.categories, body,
    extraHead: '<meta name="robots" content="noindex">',
  });
}

module.exports.ненайдено = ненайдено;
