// Сборщики страниц. Каждая функция возвращает готовый HTML.

const { page, schemaOrg, КОНТАКТЫ } = require('./layout.js');
const Ф = require('./facts.js');

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// Заглушка контакта: пунктирная рамка, чтобы незаполненное было видно сразу
const мб = (значение, заглушка) => заглушка
  ? `<span class="stub">${esc(значение)}</span>`
  : esc(значение);

/* ─────────── Карточка товара в сетке ─────────── */

function карточка(p, { lazy = true } = {}) {
  const фото = p.photos[0];
  return `<article class="card" data-cat="${esc(p.category)}" data-layout="${esc(p.layout)}"
         data-style="${esc(p.style)}" data-palette="${esc(p.palette)}">
  <a class="card-img" href="/product/${p.slug}/">
    <img src="/${фото.card}" alt="${esc(p.name)} — ${esc(p.short)}"
         width="800" height="1000"${lazy ? ' loading="lazy"' : ''} decoding="async">
    <span class="card-tag">${esc(p.category)}</span>
  </a>
  <div class="card-body">
    <h3><a href="/product/${p.slug}/">${esc(p.name)}</a></h3>
    <p class="card-desc">${esc(p.short)}</p>
    <div class="card-meta">
      <span class="chip">${esc(p.layout)}</span>
      <span class="chip">${esc(p.style)}</span>
    </div>
    <div class="card-foot">
      <button class="btn btn-ghost btn-sm" data-cart-btn data-id="${esc(p.id)}"
              data-name="${esc(p.name)}" data-category="${esc(p.category)}"
              data-slug="${p.slug}" data-img="${фото.card}"
              onclick="cartToggleFromButton(this)">В корзину</button>
    </div>
  </div>
</article>`;
}

/* ─────────── Блок фильтров ─────────── */

function фильтры(каталог, { фиксКатегория = null } = {}) {
  const группа = (ключ, заголовок, список) => `
    <div class="filter-group">
      <h4>${заголовок}</h4>
      <div class="pills">
        ${список.map(f => `<button class="pill" data-filter="${ключ}" data-value="${esc(f.value)}">${esc(f.value)}<span class="n">${f.count}</span></button>`).join('\n        ')}
      </div>
    </div>`;

  const категории = фиксКатегория ? '' : группа('cat', 'Раздел',
    каталог.categories.map(c => ({ value: c.name, count: c.count })));

  // Раздел виден сразу — им пользуются почти все. Планировка, стиль и гамма
  // убраны под кнопку: вместе это больше двадцати кнопок, и открытыми они
  // занимают весь первый экран, отодвигая сам каталог вниз.
  return `<div class="filters">
  <div class="filters-top">
    <strong>Подбор</strong>
    <button class="filters-more" id="filtersMore" type="button" aria-expanded="false" aria-controls="filtersAdvanced">
      Все фильтры
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <button class="filters-reset" id="filtersReset" type="button">сбросить</button>
    <span class="filters-count" id="filtersCount"></span>
  </div>
  ${категории}
  <div id="filtersAdvanced" hidden>
    ${группа('layout', 'Планировка и тип', каталог.filters.layout)}
    ${группа('style', 'Стиль', каталог.filters.style)}
    ${группа('palette', 'Гамма', каталог.filters.palette)}
  </div>
</div>`;
}

/* ─────────── Главная ─────────── */

// Факты бегущей строки. Количество моделей считается из каталога,
// остальное — условия заказчика из site/facts.js.
const ФАКТЫ = всего => [
  [String(всего), 'моделей в каталоге'],
  ['Напрямую', 'от производителя'],
  ['Выездной', 'шоу-рум с образцами'],
  ['Индивидуальная', 'цена под ваш проект'],
  [Ф.срокКоротко, 'срок изготовления'],
  [Ф.гарантия, `гарантии ${Ф.гарантияНаЧто}`],
];

// Раздел в единственном числе — «Кухня «Дюна»» читается живее, чем «Кухни».
const ЕДИНСТВЕННОЕ = {
  'Кухни': 'Кухня', 'Шкафы и гардеробные': 'Шкаф', 'Гостиные': 'Гостиная',
  'Спальни': 'Спальня', 'Прихожие': 'Прихожая', 'Детские': 'Детская', 'Столы': 'Стол',
};

// Слайды героя: по первому товару из пяти разделов. Берём из каталога, а не
// списком вручную, — если товар переименуют или уберут, подпись не соврёт.
function слайдыГероя(каталог) {
  const разделы = ['Кухни', 'Шкафы и гардеробные', 'Гостиные', 'Спальни', 'Прихожие'];
  return разделы.map(кат => {
    const p = каталог.products.find(x => x.category === кат);
    if (!p) return null;
    return {
      slug: p.slug, фото: p.photos[0].full, alt: `${p.name} — ${p.short}`,
      подпись: `${ЕДИНСТВЕННОЕ[кат] || кат} «${p.name}»`,
    };
  }).filter(Boolean);
}

function главная(каталог) {
  const всего = каталог.products.length;
  const ГЕРОЙ = слайдыГероя(каталог);
  // Первый слайд грузим в приоритете, остальные лениво — иначе первый экран
  // тянет пять больших фотографий вместо одной.
  const слайды = ГЕРОЙ.map((s, i) => `
      <a class="hero-slide${i ? '' : ' on'}" href="/product/${s.slug}/" data-slide="${i}"${i ? ' tabindex="-1" aria-hidden="true"' : ''}>
        <img src="/${s.фото}" width="1200" height="900" alt="${esc(s.alt)}"
             ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
        <span class="hero-shot-tag">${esc(s.подпись)} — смотреть</span>
      </a>`).join('');
  const факты = ФАКТЫ(всего);
  // Ленту дублируем: анимация уезжает ровно на половину ширины, и склейка
  // получается бесшовной
  const лента = [...факты, ...факты].map(([n, d]) => `
      <div class="m-item">
        <div class="m-num">${esc(n)}</div>
        <div class="m-desc">${esc(d)}</div>
      </div>
      <div class="m-dot"></div>`).join('');

  const плитки = каталог.categories.map(c => `
      <a class="tile" href="/catalog/?cat=${encodeURIComponent(c.name)}">
        <img src="/${c.cover}" alt="${esc(c.name)}" width="800" height="1000" loading="lazy" decoding="async">
        <span class="tile-cap"><b>${esc(c.name)}</b><span>${c.count} ${plural(c.count, 'модель', 'модели', 'моделей')}</span></span>
      </a>`).join('');

  const шаги = Ф.шаги.map(([t, d], i) => `
      <div class="step">
        <div class="step-num">${i + 1}</div>
        <h3>${esc(t)}</h3>
        <p>${esc(d)}</p>
      </div>`).join('');

  const преимущества = Ф.преимущества.map(([t, d]) => `
      <li class="adv">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <span><b>${esc(t)}</b> — ${esc(d)}</span>
      </li>`).join('');

  const входит = Ф.входитВСтоимость.map(п => `
      <li class="adv">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <span>${esc(п)}</span>
      </li>`).join('');

  const body = `
<section id="hero">
  <div class="hero-inner">
    <div class="hero-brand-col">
      <p class="hero-tag">Выездной шоу-рум мебели · на заказ ${esc(Ф.срокКоротко)}</p>
      <h1>Кухни, шкафы и гардеробные на заказ</h1>
      <p class="hero-sub">${всего} ${plural(всего, 'модель', 'модели', 'моделей')} в каталоге. Дизайнер приедет к вам с образцами, бесплатно сделает замер и проект — из дома выходить не нужно.</p>
      <div class="hero-btns">
        <a href="/catalog/" class="btn btn-primary">Смотреть каталог</a>
        <a href="/contacts/" class="btn btn-secondary">Вызвать дизайнера</a>
      </div>
    </div>

    <!-- В герое живые товары из каталога, а не абстрактный рендер: человек
         должен в первую секунду увидеть, что мы продаём. Слайды сменяются
         сами — по одному из разных разделов, чтобы показать ассортимент.
         Слайдер «было/стало» уехал ниже, к рассказу о работе. -->
    <div class="hero-shot" id="heroShot">
      ${слайды}
      <!-- Стрелки и точки лежат поверх слайда, поэтому это кнопки, а не ссылки:
           внутри слайда уже есть ссылка на товар, и вложить одну в другую нельзя. -->
      <button type="button" class="hero-arrow hero-prev" aria-label="Предыдущая работа">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button type="button" class="hero-arrow hero-next" aria-label="Следующая работа">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
      <div class="hero-dots" id="heroDots" role="tablist" aria-label="Примеры работ">
        ${ГЕРОЙ.map((s, i) => `<button type="button" class="hero-dot${i ? '' : ' on'}"
          data-slide="${i}" role="tab" aria-selected="${i ? 'false' : 'true'}"
          aria-label="${esc(s.подпись)}"></button>`).join('\n        ')}
      </div>
    </div>
  </div>
</section>

<section id="trust" aria-label="Коротко о работе">
  <div class="marquee">${лента}</div>
</section>

<!-- «Мебель под ключ» и «Что входит в стоимость» стоят рядом в две колонки.
     По отдельности каждый блок занимал узкую полосу слева, и справа от него
     оставалась пустая треть экрана. Вместе они закрывают всю ширину и заодно
     читаются как одно целое: что делаем и что за это уже уплачено. -->
<section id="offer" class="dark">
  <div class="container">
    <!-- Слева обещание, справа обязательства — поэтому оформлены по-разному.
         Карточка только у правой: там конкретика, которую человек ищет
         глазами. Две одинаковые коробки рядом смотрелись бы тяжелее и не
         подсказывали бы, где что. -->
    <div class="two-col">
      <div class="offer-claim">
        <div class="section-head">
          <h2>Мебель под ключ</h2>
          <p>Мы делаем всё сами: замер, дизайн-проект, доставку и сборку. Вам остаётся только выбрать.</p>
        </div>
        <ul class="adv-list">${преимущества}</ul>

        <!-- Левая колонка была на 153 px короче правой, и снизу зияла дыра.
             Закрываем её тем, чего в секции не хватало, — призывом к действию. -->
        <div class="offer-cta">
          <a href="/catalog/" class="btn btn-primary">Смотреть каталог</a>
          <p class="offer-warranty">Гарантия ${esc(Ф.гарантия)} ${esc(Ф.гарантияНаЧто)}.
             Срок изготовления — ${esc(Ф.срокИзготовления)}.</p>
        </div>
      </div>

      <div class="offer-card">
        <div class="section-head">
          <h2>Что входит в стоимость</h2>
          <p>Цена ${esc(Ф.ценаПояснение)}.</p>
        </div>
        <ul class="adv-list">${входит}</ul>
        <p class="note-strong">${esc(Ф.безСкрытыхДоплат)}</p>
        <p class="product-note">${esc(Ф.сборкаОтдельно)} ${esc(Ф.безЛифта)}</p>
      </div>
    </div>
  </div>
</section>

<section id="picker" class="dark">
  <div class="container">
    <div class="section-head">
      <h2>С чего начнём?</h2>
      <p>Выберите раздел — покажем, что есть, и подберём под ваше помещение.</p>
    </div>
    <div class="tiles">${плитки}</div>
  </div>
</section>

<!-- «Было — стало» стоит между выбором раздела и рассказом о работе
     намеренно: человек выбрал комнату, здесь видит, во что она превращается,
     и только потом читает, как мы к этому идём. Раньше блок висел в конце
     «Как это работает» — не к месту по смыслу (шаги про процесс, слайдер
     про результат) и в одиночестве посреди широкой тёмной секции.
     Две колонки закрывают и то, и другое: слева рассказ, справа картинка. -->
<section id="result" class="dark">
  <div class="container">
    <div class="two-col">
      <div class="result-text">
        <div class="section-head">
          <h2>Что меняется в комнате</h2>
          <p>Чистовая отделка — это ещё не жильё. Мебель по размеру превращает
             пустые стены в комнату, где всё на своих местах.</p>
        </div>
        <p class="result-note">Каждый проект начинается с замера: мы считаем мебель
           под ваши стены, окна и двери, а не подгоняем комнату под готовый гарнитур.</p>
        <div class="result-cta">
          <a href="/catalog/" class="btn btn-primary">Смотреть каталог</a>
        </div>
      </div>

      <div class="ba-block">
        <div class="ba" id="ba">
          <img src="/img/room-6.avif" alt="Комната с расставленной мебелью" width="1024" height="1024" loading="lazy">
          <div class="ba-before">
            <img src="/img/room-0.avif" alt="Та же комната без мебели, только чистовая отделка" width="1024" height="1024" loading="lazy">
          </div>
          <div class="ba-line"></div>
          <button class="ba-grip" id="baGrip" type="button" role="slider"
                  aria-label="Сравнить пустую и обставленную комнату"
                  aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" transform="translate(-3 0)"/>
              <polyline points="9 18 15 12 9 6" transform="translate(3 0)"/>
            </svg>
          </button>
          <span class="ba-tag l">Было</span>
          <span class="ba-tag r">Стало</span>
        </div>
        <p class="ba-hint">Потяните ручку — комната обставится</p>
      </div>
    </div>
  </div>
</section>

<section id="how" class="dark">
  <div class="container">
    <div class="section-head">
      <h2>Как это работает</h2>
      <p>${Ф.шаги.length} ${plural(Ф.шаги.length, 'шаг', 'шага', 'шагов')} от заявки до сборки.</p>
    </div>
    <div class="steps">${шаги}</div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head">
      <h2>Куда возим</h2>
      <p>Три региона — доставка и выезд дизайнера в каждом. За их пределы пока не возим.</p>
    </div>
    <div class="tiles-simple">
      ${Ф.основныеРегионы.map(c => `<div class="city-card"><h3>${esc(c)}</h3><p>Выезд дизайнера и доставка</p></div>`).join('\n      ')}
    </div>
    ${Ф.другиеГорода ? `<p class="product-note" style="margin-top:18px;">${esc(Ф.другиеГорода)}</p>` : ''}
  </div>
</section>

<!-- Форма стояла узкой колонкой по центру, и по бокам зияла пустота.
     Ставим её справа, а слева — то, что снимает главные сомнения перед
     тем, как оставить номер. -->
<section id="lead">
  <div class="container">
    <div class="two-col">
      <div>
        <div class="section-head">
          <h2>Обсудим ваш проект</h2>
          <p>Оставьте номер — свяжемся и договоримся о выезде дизайнера. Ни к чему не обязывает.</p>
        </div>
        <ul class="adv-list">
          ${[
            ['Замер и дизайн-проект', 'бесплатно, до всякой оплаты'],
            ['Дизайнер приедет', esc(Ф.выездСрок)],
            ['Изготовление', esc(Ф.срокИзготовления)],
            ['Гарантия', `${esc(Ф.гарантия)} ${esc(Ф.гарантияНаЧто)}`],
          ].map(([t, d]) => `
          <li class="adv">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            <span><b>${t}</b> — ${d}</span>
          </li>`).join('')}
        </ul>
      </div>
      <div>
        ${формаЗаявки('заявка с главной')}
      </div>
    </div>
  </div>
</section>`;

  return page({
    title: 'Атмосфера Мебель — кухни, шкафы и гардеробные на заказ',
    description: `Кухни, шкафы-купе и гардеробные на заказ по вашим размерам. Выездной шоу-рум: дизайнер приедет с образцами, замер и проект бесплатно. Изготовление ${Ф.срокКоротко}.`,
    canonical: '/', active: 'home', категории: каталог.categories, body,
    extraHead: schemaOrg({
      '@context': 'https://schema.org', '@type': 'Organization',
      name: 'Атмосфера Мебель', url: КОНТАКТЫ.site,
      logo: КОНТАКТЫ.site + '/favicon-512.png',
      areaServed: Ф.основныеРегионы,
    }),
  });
}

/* ─────────── Форма заявки ─────────── */

function формаЗаявки(метка) {
  return `<form class="cart-form" data-lead="${esc(метка)}">
  <div class="field">
    <label for="lf-name-${esc(метка).replace(/\W/g, '')}">Как к вам обращаться</label>
    <input id="lf-name-${esc(метка).replace(/\W/g, '')}" name="name" type="text" autocomplete="name" placeholder="Имя">
    <div class="err">Напишите имя</div>
  </div>
  <div class="field">
    <label for="lf-phone-${esc(метка).replace(/\W/g, '')}">Телефон</label>
    <input id="lf-phone-${esc(метка).replace(/\W/g, '')}" name="phone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00">
    <div class="err">Нужен номер из 10 цифр</div>
  </div>
  <div class="field">
    <label for="lf-contact-${esc(метка).replace(/\W/g, '')}">Где удобнее общаться</label>
    <select id="lf-contact-${esc(метка).replace(/\W/g, '')}" name="contact">
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
</form>`;
}

/* ─────────── Каталог ─────────── */

function каталогСтраница(каталог) {
  const всего = каталог.products.length;
  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span>Каталог</nav>
  <div class="page-head">
    <h1>Каталог</h1>
    <p>${всего} ${plural(всего, 'модель', 'модели', 'моделей')}: кухни, шкафы-купе, гардеробные, мебель для гостиной, спальни, прихожей и детской. Любую модель адаптируем под размеры вашего помещения.</p>
  </div>
  ${фильтры(каталог)}
  <div class="grid" id="catalogRoot">
    ${каталог.products.map((p, i) => карточка(p, { lazy: i >= 8 })).join('\n    ')}
  </div>
  <div class="empty" id="catalogEmpty" hidden>
    <h3>Ничего не нашлось</h3>
    <p>Попробуйте снять часть условий — или напишите нам, подберём вручную.</p>
  </div>
</div>
<div style="height:60px"></div>`;

  return page({
    title: `Каталог мебели на заказ — ${всего} моделей | Атмосфера Мебель`,
    description: 'Кухни, шкафы-купе, гардеробные и мебель для комнат на заказ. Подбор по планировке, стилю и цветовой гамме. Бесплатный замер и проект, изготовление 7–14 дней.',
    canonical: '/catalog/', active: 'catalog', категории: каталог.categories, body,
  });
}

/* ─────────── Страница категории ─────────── */

function категорияСтраница(каталог, категория, тексты) {
  const товары = каталог.products.filter(p => p.category === категория.name);
  const n = товары.length;

  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span><a href="/catalog/">Каталог</a><span>/</span>${esc(категория.name)}</nav>
  <div class="page-head">
    <h1>${esc(тексты.h1)}</h1>
    <p>${esc(тексты.lead)}</p>
  </div>
  ${фильтры(каталог, { фиксКатегория: категория.name })}
  <div class="grid" id="catalogRoot">
    ${товары.map((p, i) => карточка(p, { lazy: i >= 8 })).join('\n    ')}
  </div>
  <div class="empty" id="catalogEmpty" hidden>
    <h3>Ничего не нашлось</h3>
    <p>Попробуйте снять часть условий.</p>
  </div>

  <div class="article" style="max-width:760px;padding-top:20px;">
    ${тексты.body}
  </div>
</div>`;

  return page({
    title: тексты.title,
    description: тексты.description,
    canonical: тексты.url, active: тексты.active,
    категории: каталог.categories, body,
    ogImage: товары[0] ? товары[0].photos[0].card : undefined,
  });
}

/* ─────────── Карточка товара ─────────── */

function товарСтраница(каталог, p) {
  const похожие = каталог.products
    .filter(x => x.id !== p.id && x.category === p.category)
    .sort((a, b) => (b.style === p.style) - (a.style === p.style)
                 || (b.palette === p.palette) - (a.palette === p.palette))
    .slice(0, 4);

  const миниатюры = p.photos.length > 1 ? `
    <div class="gallery-thumbs">
      ${p.photos.map((f, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-full="/${f.full}" aria-label="Кадр ${i + 1}">
        <img src="/${f.card}" alt="" width="800" height="1000" loading="lazy" decoding="async"></button>`).join('\n      ')}
    </div>` : '';

  const body = `
<div class="container">
  <nav class="crumbs">
    <a href="/">Главная</a><span>/</span>
    <a href="/catalog/">Каталог</a><span>/</span>
    <a href="/catalog/?cat=${encodeURIComponent(p.category)}">${esc(p.category)}</a><span>/</span>${esc(p.name)}
  </nav>

  <div class="product">
    <div>
      <div class="gallery-main">
        <img id="galleryMain" src="/${p.photos[0].full}" alt="${esc(p.name)} — ${esc(p.short)}"
             width="1400" height="1400" fetchpriority="high" decoding="async">
      </div>
      ${миниатюры}
    </div>

    <div class="product-info">
      <h1>${esc(p.name)}</h1>
      <p class="product-lead">${esc(p.short)}</p>
      <p>${esc(p.text)}</p>

      <div class="spec">
        <div><dt>Раздел</dt><dd>${esc(p.category)}</dd></div>
        <div><dt>Тип и планировка</dt><dd>${esc(p.layout)}</dd></div>
        <div><dt>Стиль</dt><dd>${esc(p.style)}</dd></div>
        <div><dt>Цветовая гамма</dt><dd>${esc(p.palette)}</dd></div>
        <div><dt>Размеры</dt><dd>Изготавливаем по вашим размерам</dd></div>
        <div><dt>Срок изготовления</dt><dd>${esc(Ф.срокИзготовления)}</dd></div>
        <div><dt>Гарантия</dt><dd>${esc(Ф.гарантия)} ${esc(Ф.гарантияНаЧто)}</dd></div>
        <div><dt>Стоимость</dt><dd>Индивидуальная — после встречи с дизайнером</dd></div>
      </div>

      <h3 style="font-family:var(--font-d);font-size:20px;">Особенности модели</h3>
      <div class="product-items">
        ${p.items.map(i => `<span class="chip">${esc(i)}</span>`).join('\n        ')}
      </div>

      <div class="product-buy">
        <button class="btn btn-primary" data-cart-btn data-id="${esc(p.id)}"
                data-name="${esc(p.name)}" data-category="${esc(p.category)}"
                data-slug="${p.slug}" data-img="${p.photos[0].card}"
                data-label-add="Добавить в корзину"
                onclick="cartToggleFromButton(this)">Добавить в корзину</button>
        <a href="/cart/" class="btn btn-ghost">Перейти в корзину</a>
      </div>
      <p class="product-note">Добавление в корзину ничего не оплачивает и ни к чему не обязывает. Дизайнер приедет с образцами, сделает замер и рассчитает стоимость — замер и проект бесплатные.</p>
    </div>
  </div>

  ${похожие.length ? `
  <section style="padding-bottom:60px;">
    <div class="section-head"><h2>Похожее в разделе «${esc(p.category)}»</h2></div>
    <div class="grid">
      ${похожие.map(x => карточка(x)).join('\n      ')}
    </div>
  </section>` : ''}
</div>`;

  return page({
    title: `${p.name} — ${p.short} | Атмосфера Мебель`,
    description: p.short + '. Изготовление по вашим размерам за 7–14 дней. Бесплатный замер и дизайн-проект, цена индивидуальная.',
    canonical: `/product/${p.slug}/`, active: 'catalog',
    категории: каталог.categories, body, ogImage: p.photos[0].full,
    extraHead: schemaOrg({
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.name, description: p.text,
      image: p.photos.map(f => `${КОНТАКТЫ.site}/${f.full}`),
      category: p.category,
      brand: { '@type': 'Brand', name: 'Атмосфера Мебель' },
    }),
  });
}

module.exports = { главная, каталогСтраница, категорияСтраница, товарСтраница, карточка, формаЗаявки, esc, plural, мб };
