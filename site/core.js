// Общий скрипт всех страниц: шапка, корзина, каталог, галерея, отправка заявок.
//
// Страницы собираются статически, поэтому здесь нет никакой маршрутизации:
// каждый блок сам проверяет, есть ли на странице его разметка, и молча
// выходит, если её нет.

/* ═══════════ Мелочи ═══════════ */

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  requestAnimationFrame(() => el.classList.add('on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ═══════════ Заявки ═══════════
   Сервер при сбое отвечает 200 с ok:false, чтобы в консоли клиента не мигали
   красные ошибки. Поэтому разбираем именно тело ответа, а не статус. */

async function sendRequest(payload) {
  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// Телефон приводим к +7XXXXXXXXXX: берём последние 10 цифр, поэтому и
// 8999…, и +7999…, и 999… дают один и тот же результат.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return '+7' + digits.slice(-10);
}

/* ═══════════ Корзина ═══════════
   Это корзина-заявка: цен нет, сумма не считается. Храним только id и
   минимум для отрисовки, чтобы не тащить в localStorage весь каталог. */

const CART_KEY = 'am_cart';

function cartRead() {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => x && x.id) : [];
  } catch { return []; }
}

function cartWrite(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  cartPaintCount();
  document.dispatchEvent(new CustomEvent('cart:change'));
}

function cartHas(id) { return cartRead().some(x => x.id === id); }

function cartAdd(item) {
  const items = cartRead();
  if (items.some(x => x.id === item.id)) return false;
  items.push(item);
  cartWrite(items);
  return true;
}

function cartRemove(id) { cartWrite(cartRead().filter(x => x.id !== id)); }

function cartPaintCount() {
  const n = cartRead().length;
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = n;
    el.classList.toggle('on', n > 0);
  });
}

// Кнопка «В заявку» на карточке товара и в сетке каталога
function cartToggleFromButton(btn) {
  const item = {
    id: btn.dataset.id,
    name: btn.dataset.name,
    category: btn.dataset.category,
    slug: btn.dataset.slug,
    img: btn.dataset.img,
  };
  if (cartHas(item.id)) {
    cartRemove(item.id);
    btn.classList.remove('added');
    btn.textContent = btn.dataset.labelAdd || 'В корзину';
    toast('Убрали из корзины');
  } else {
    cartAdd(item);
    btn.classList.add('added');
    btn.textContent = 'В корзине ✓';
    toast('Добавили в корзину');
  }
}

function cartPaintButtons(root = document) {
  root.querySelectorAll('[data-cart-btn]').forEach(btn => {
    const on = cartHas(btn.dataset.id);
    btn.classList.toggle('added', on);
    btn.textContent = on ? 'В корзине ✓' : (btn.dataset.labelAdd || 'В корзину');
  });
}

/* ═══════════ Шапка ═══════════ */

function toggleMobileMenu() {
  const m = document.getElementById('mobileMenu');
  if (m) m.classList.toggle('open');
}

// Выпадающий список разделов под кнопкой «Каталог»
function toggleCatalogMenu(btn) {
  const menu = document.getElementById('navDropMenu');
  if (!menu) return;
  const открыт = !menu.hidden;
  menu.hidden = открыт;
  btn.setAttribute('aria-expanded', String(!открыт));
}

function initNav() {
  const nav = document.getElementById('navbar');
  if (!nav) return;

  // Шапка над тёмной секцией становится прозрачной со светлым текстом.
  // Считаем по нижней кромке шапки: как только под ней оказывается
  // шоколадный блок — переключаемся.
  const тёмные = [...document.querySelectorAll('section.dark, #trust, footer')];
  const высотаШапки = () => nav.getBoundingClientRect().height || 72;

  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 10);
    const кромка = высотаШапки() - 2;
    const надТёмным = тёмные.some(s => {
      const r = s.getBoundingClientRect();
      return r.top <= кромка && r.bottom > кромка;
    });
    nav.classList.toggle('over-dark', надТёмным);
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  // Клик мимо списка и Esc его закрывают
  document.addEventListener('click', e => {
    const menu = document.getElementById('navDropMenu');
    if (!menu || menu.hidden) return;
    if (e.target.closest('.nav-drop')) return;
    menu.hidden = true;
    const btn = document.querySelector('.nav-drop .nav-link');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const menu = document.getElementById('navDropMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    const btn = document.querySelector('.nav-drop .nav-link');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
  });
}

/* ═══════════ Каталог ═══════════
   Товары уже лежат в разметке (страницы статические, это важно для поиска),
   поэтому фильтр не перерисовывает сетку, а прячет лишние карточки. */

function initCatalog() {
  const root = document.getElementById('catalogRoot');
  if (!root) return;

  const cards = [...root.querySelectorAll('.card[data-cat]')];
  const countEl = document.getElementById('filtersCount');
  const emptyEl = document.getElementById('catalogEmpty');
  const state = { cat: '', layout: '', style: '', palette: '' };

  // Категорию можно задать адресом: /catalog/?cat=Кухни.
  // Заодно меняем заголовок страницы — иначе переход из раздела выглядел
  // так, будто ничего не произошло: фильтр отработал, а шапка осталась
  // прежней, и было непонятно, что каталог уже сузился.
  const q = new URLSearchParams(location.search);
  const изАдреса = q.get('cat');
  if (изАдреса) {
    state.cat = изАдреса;
    const h1 = document.querySelector('.page-head h1');
    const lead = document.querySelector('.page-head p');
    const крошки = document.querySelector('.crumbs');
    if (h1) { h1.textContent = изАдреса; document.title = изАдреса + ' | Атмосфера Мебель'; }
    if (lead) lead.textContent = 'Показаны только модели из этого раздела. Любую адаптируем под размеры вашего помещения.';
    if (крошки && !крошки.dataset.cat) {
      крошки.dataset.cat = '1';
      крошки.insertAdjacentHTML('beforeend', `<span>/</span>${esc(изАдреса)}`);
    }
  }

  // Все 137 карточек одной страницей давали двадцать тысяч пикселей высоты.
  // Показываем по 24: скрытые карточки не грузят свои изображения вовсе,
  // а фильтры продолжают работать по всему набору, а не по видимой части.
  const ШАГ = 24;
  let лимит = ШАГ;

  const ещё = document.createElement('button');
  ещё.type = 'button';
  ещё.className = 'btn btn-ghost more-btn';
  ещё.hidden = true;
  ещё.addEventListener('click', () => { лимит += ШАГ; apply(); });
  root.insertAdjacentElement('afterend', ещё);

  function apply() {
    let shown = 0, влезло = 0;
    cards.forEach(c => {
      const ok = (!state.cat || c.dataset.cat === state.cat)
              && (!state.layout || c.dataset.layout === state.layout)
              && (!state.style || c.dataset.style === state.style)
              && (!state.palette || c.dataset.palette === state.palette);
      if (ok) {
        shown++;
        const место = влезло < лимит;
        c.hidden = !место;
        if (место) влезло++;
      } else {
        c.hidden = true;
      }
    });
    const осталось = shown - влезло;
    ещё.hidden = осталось <= 0;
    if (осталось > 0) {
      ещё.textContent = 'Показать ещё ' + Math.min(ШАГ, осталось)
        + ' из ' + осталось;
    }
    if (countEl) countEl.textContent = shown + ' ' + plural(shown, 'товар', 'товара', 'товаров');
    if (emptyEl) emptyEl.hidden = shown > 0;

    document.querySelectorAll('.pill[data-filter]').forEach(p => {
      p.classList.toggle('on', state[p.dataset.filter] === p.dataset.value);
    });
  }

  document.querySelectorAll('.pill[data-filter]').forEach(p => {
    p.addEventListener('click', () => {
      const k = p.dataset.filter;
      state[k] = state[k] === p.dataset.value ? '' : p.dataset.value;
      лимит = ШАГ;   // новый отбор показываем с начала, а не с прошлой порции
      apply();
    });
  });

  const reset = document.getElementById('filtersReset');
  if (reset) reset.addEventListener('click', () => {
    Object.keys(state).forEach(k => state[k] = '');
    лимит = ШАГ;
    apply();
  });

  // Расширенные фильтры под кнопкой
  const more = document.getElementById('filtersMore');
  const adv = document.getElementById('filtersAdvanced');
  if (more && adv) {
    // Если человек пришёл по ссылке с уже выбранной планировкой или стилем,
    // панель надо открыть сразу — иначе непонятно, почему товаров мало
    if (q.get('layout') || q.get('style') || q.get('palette')) adv.hidden = false;
    ['layout', 'style', 'palette'].forEach(k => { if (q.get(k)) state[k] = q.get(k); });

    more.setAttribute('aria-expanded', String(!adv.hidden));
    more.addEventListener('click', () => {
      adv.hidden = !adv.hidden;
      more.setAttribute('aria-expanded', String(!adv.hidden));
    });
  }

  apply();
}

/* ═══════════ Галерея товара ═══════════ */

function initGallery() {
  const main = document.getElementById('galleryMain');
  if (!main) return;
  document.querySelectorAll('.gallery-thumbs button').forEach(b => {
    b.addEventListener('click', () => {
      main.src = b.dataset.full;
      document.querySelectorAll('.gallery-thumbs button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
  });
}

/* ═══════════ Страница корзины ═══════════ */

function initCartPage() {
  const list = document.getElementById('cartList');
  if (!list) return;

  const form = document.getElementById('cartForm');
  const empty = document.getElementById('cartEmpty');
  const layout = document.getElementById('cartLayout');

  function paint() {
    const items = cartRead();
    const n = items.length;

    // Заголовок обновляем ДО выхода по пустой корзине. Раньше он стоял в
    // конце функции, и при удалении последней позиции сюда уже не доходили:
    // корзина пустела, а сверху так и висело «1 позиция в корзине».
    const h = document.getElementById('cartHeading');
    if (h) h.textContent = n
      ? n + ' ' + plural(n, 'позиция', 'позиции', 'позиций') + ' в корзине'
      : 'Корзина';

    if (!n) {
      if (layout) layout.hidden = true;
      if (empty) empty.hidden = false;
      list.innerHTML = '';          // иначе удалённая строка остаётся в разметке
      return;
    }
    if (layout) layout.hidden = false;
    if (empty) empty.hidden = true;

    list.innerHTML = items.map(i => `
      <div class="cart-row">
        <img src="/${esc(i.img)}" alt="${esc(i.name)}" loading="lazy">
        <div>
          <h3><a href="/product/${esc(i.slug)}/">${esc(i.name)}</a></h3>
          <div class="sub">${esc(i.category)} · цена индивидуальная</div>
        </div>
        <button class="cart-del" data-del="${esc(i.id)}" aria-label="Убрать ${esc(i.name)}">×</button>
      </div>`).join('');

    // paint вызовется сам: cartRemove шлёт событие cart:change,
    // на которое мы подписаны ниже
    list.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => cartRemove(b.dataset.del));
    });
  }

  paint();
  document.addEventListener('cart:change', paint);

  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const nameF = form.querySelector('[name=name]').closest('.field');
    const phoneF = form.querySelector('[name=phone]').closest('.field');
    const name = form.name.value.trim();
    const phone = normalizePhone(form.phone.value);

    nameF.classList.toggle('bad', name.length < 2);
    phoneF.classList.toggle('bad', !phone);
    if (name.length < 2 || !phone) return;

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Отправляем…';

    const items = cartRead();
    const res = await sendRequest({
      kind: 'order',
      name, phone,
      contact: form.contact.value,
      website: form.website.value,          // ловушка для ботов
      project: items.map(i => `${i.category}: ${i.name}`).join('; '),
      summary: `Заявка из корзины, позиций: ${items.length}`,
    });

    if (res && res.ok) {
      cartWrite([]);
      const done = document.getElementById('cartDone');
      if (done) { done.hidden = false; done.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if (layout) layout.hidden = true;
      if (empty) empty.hidden = true;
    } else {
      btn.disabled = false;
      btn.textContent = 'Отправить заявку';
      toast('Не удалось отправить. Попробуйте ещё раз чуть позже.');
    }
  });
}

/* ═══════════ Простая форма заявки (главная, контакты) ═══════════ */

function initLeadForms() {
  document.querySelectorAll('form[data-lead]').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const nameF = form.querySelector('[name=name]').closest('.field');
      const phoneF = form.querySelector('[name=phone]').closest('.field');
      const name = form.name.value.trim();
      const phone = normalizePhone(form.phone.value);

      nameF.classList.toggle('bad', name.length < 2);
      phoneF.classList.toggle('bad', !phone);
      if (name.length < 2 || !phone) return;

      const btn = form.querySelector('button[type=submit]');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Отправляем…';

      const res = await sendRequest({
        kind: 'consult',
        name, phone,
        contact: form.contact ? form.contact.value : 'call',
        website: form.website ? form.website.value : '',
        project: form.dataset.lead || 'заявка с сайта',
      });

      if (res && res.ok) {
        form.innerHTML = '<h3>Заявка принята</h3><p class="hint">Свяжемся с вами в ближайшее время.</p>';
      } else {
        btn.disabled = false;
        btn.textContent = label;
        toast('Не удалось отправить. Попробуйте ещё раз.');
      }
    });
  });
}

/* ═══════════ Правки из админки ═══════════
   Страницы собраны заранее, поэтому изменения из админки применяются здесь,
   поверх готовой разметки: скрыть товар, переименовать, проставить цену.
   Файла может не быть — это нормальное состояние, пока ничего не правили. */

async function applyOverrides() {
  let правки;
  try {
    const r = await fetch('/data/overrides.json', { cache: 'no-cache' });
    if (!r.ok) return;
    правки = await r.json();
  } catch { return; }
  if (!правки || typeof правки !== 'object') return;

  // Карточки в сетке
  document.querySelectorAll('.card [data-cart-btn]').forEach(btn => {
    const п = правки[btn.dataset.id];
    if (!п) return;
    const card = btn.closest('.card');
    if (п.hidden) { card.remove(); return; }
    if (п.name) {
      card.querySelectorAll('h3 a').forEach(a => a.textContent = п.name);
      btn.dataset.name = п.name;
    }
    if (п.price) {
      const c = card.querySelector('.card-price');
      if (c) c.innerHTML = '<b>' + esc(п.price) + '</b>';
    }
  });

  // Страница товара
  const главная = document.querySelector('.product-buy [data-cart-btn]');
  if (главная) {
    const п = правки[главная.dataset.id];
    if (п && п.hidden) { location.replace('/catalog/'); return; }
    if (п && п.name) {
      const h1 = document.querySelector('.product-info h1');
      if (h1) h1.textContent = п.name;
      главная.dataset.name = п.name;
      document.title = п.name + ' | Атмосфера Мебель';
    }
    if (п && п.price) {
      document.querySelectorAll('.spec dd').forEach(dd => {
        if (dd.textContent.includes('Договорная')) dd.textContent = п.price;
      });
    }
  }

  // Счётчик в фильтрах после удаления скрытых
  const countEl = document.getElementById('filtersCount');
  if (countEl && document.getElementById('catalogRoot')) {
    const n = document.querySelectorAll('#catalogRoot .card:not([hidden])').length;
    countEl.textContent = n + ' ' + plural(n, 'товар', 'товара', 'товаров');
  }
}

/* ═══════════ Статьи из админки ═══════════ */

async function initBlogExtra() {
  const list = document.querySelector('.posts');
  if (!list) return;
  let посты;
  try {
    const r = await fetch('/data/blog.json', { cache: 'no-cache' });
    if (!r.ok) return;
    посты = await r.json();
  } catch { return; }
  if (!Array.isArray(посты) || !посты.length) return;

  // Свежие — сверху: админка добавляет новые в начало файла
  list.insertAdjacentHTML('afterbegin', посты.map(p => `
    <a class="post-card" href="/blog/${encodeURIComponent(p.slug || '')}/">
      <span class="post-date">${esc(p.dateHuman || '')}</span>
      <h3>${esc(p.title || '')}</h3>
      <p>${esc(p.lead || '')}</p>
      <span class="more">Читать →</span>
    </a>`).join(''));
}

/* ═══════════ Старт ═══════════ */

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initHeroSlider();
  cartPaintCount();
  cartPaintButtons();
  initCatalog();
  initGallery();
  initCartPage();
  initLeadForms();
  applyOverrides();
  initBlogExtra();
});
