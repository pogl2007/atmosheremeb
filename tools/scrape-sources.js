// Сбор исходников по двум новым источникам.
//
// mebnika  — WooCommerce, у него есть штатный store-API: отдаёт имя, категорию
//            и все снимки товара сразу. Разметку разбирать не нужно.
// mkbastet — Tilda, API нет. Зато разделы сайта сами по себе категории
//            (/kuhni, /bed, /prihojaya…), поэтому категорию берём из адреса
//            страницы, а ссылки на снимки достаём регуляркой из HTML.
//
// Результат — data/sources/<источник>.json. Скачиванием и обработкой занимается
// отдельный шаг, здесь только адреса и подписи.

const fs = require('fs');
const path = require('path');
const { ProxyAgent, setGlobalDispatcher } = require('undici');

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                 process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const OUT = path.join(__dirname, '..', 'data', 'sources');

const пауза = ms => new Promise(r => setTimeout(r, ms));

// ── mebnika: WooCommerce ──────────────────────────────────────────────
// Свотчи материалов и карнизы — не товары нашего каталога, пропускаем.
const MEBNIKA_SKIP = ['Материалы', 'Мебельные карнизы'];

async function mebnika() {
  const все = [];
  for (let p = 1; p <= 12; p++) {
    const r = await fetch(`https://mebnika.ru/wp-json/wc/store/v1/products?per_page=100&page=${p}`);
    if (!r.ok) break;
    const d = await r.json();
    if (!d.length) break;
    все.push(...d);
    if (d.length < 100) break;
    await пауза(300);
  }

  const товары = все
    .map(p => ({
      источник: 'mebnika',
      uid: 'mb' + p.id,
      имя: p.name,
      разделы: (p.categories || []).map(c => c.name),
      images: (p.images || [])
        // WooCommerce отдаёт уменьшенную копию; без суффикса лежит оригинал
        .map(i => (i.src || '').replace(/-\d+x\d+(\.\w+)$/, '$1'))
        .filter(Boolean),
    }))
    .filter(p => p.images.length && !p.разделы.some(c => MEBNIKA_SKIP.includes(c)));

  return товары;
}

// ── mkbastet: Tilda ───────────────────────────────────────────────────
const BASTET_РАЗДЕЛЫ = {
  '/kuhni': 'Кухни',
  '/kupematch': 'Шкафы',
  '/kupe': 'Шкафы',
  '/shkafgrup': 'Шкафы',
  '/bed': 'Спальня',
  '/gostinka': 'Гостиная',
  '/prihojaya': 'Прихожая',
  '/detstvo': 'Детская',
  '/galery': 'Разное',
};

async function bastet() {
  const собрано = new Map();   // url → раздел (первый выигрывает)

  for (const [путь, раздел] of Object.entries(BASTET_РАЗДЕЛЫ)) {
    try {
      const r = await fetch('https://mkbastet.ru' + путь);
      if (!r.ok) { console.log(`  ${путь}: HTTP ${r.status}`); continue; }
      const html = await r.text();

      // Полноразмерные лежат на static.tildacdn.com; thb.* — это превью 20px,
      // они нам не нужны.
      const найдено = new Set();
      for (const m of html.matchAll(/https:\/\/static\.tildacdn\.com\/[^"'\s\\)]+?\.(?:jpg|jpeg|png|webp)/gi)) {
        найдено.add(m[0]);
      }
      let новых = 0;
      for (const u of найдено) {
        if (собрано.has(u)) continue;
        собрано.set(u, раздел); новых++;
      }
      console.log(`  ${путь.padEnd(12)} ${раздел.padEnd(10)} снимков ${найдено.size}, новых ${новых}`);
      await пауза(400);
    } catch (e) {
      console.log(`  ${путь}: ${e.message}`);
    }
  }

  // У Tilda товар и снимок не связаны разметкой, поэтому каждый снимок —
  // отдельная позиция. Имена и описания всё равно пишем свои.
  const по = {};
  [...собрано].forEach(([url, раздел]) => (по[раздел] = по[раздел] || []).push(url));

  const товары = [];
  Object.entries(по).forEach(([раздел, urls]) => {
    urls.forEach((url, i) => {
      товары.push({
        источник: 'mkbastet',
        uid: 'bs' + раздел.replace(/\W/g, '') + i,
        имя: null,                 // имя присвоим сами на шаге сборки каталога
        разделы: [раздел],
        images: [url],
      });
    });
  });
  return товары;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  console.log('mebnika (WooCommerce API):');
  const m = await mebnika();
  fs.writeFileSync(path.join(OUT, 'mebnika.json'), JSON.stringify(m, null, 2), 'utf8');
  const мКат = {};
  m.forEach(p => p.разделы.forEach(c => мКат[c] = (мКат[c] || 0) + 1));
  console.log(`  товаров ${m.length}, снимков ${m.reduce((n, p) => n + p.images.length, 0)}`);
  Object.entries(мКат).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  console.log('\nmkbastet (Tilda, категория из адреса раздела):');
  const b = await bastet();
  fs.writeFileSync(path.join(OUT, 'mkbastet.json'), JSON.stringify(b, null, 2), 'utf8');
  const бКат = {};
  b.forEach(p => бКат[p.разделы[0]] = (бКат[p.разделы[0]] || 0) + 1);
  console.log(`  снимков ${b.length}`);
  Object.entries(бКат).sort((a, b2) => b2[1] - a[1]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  console.log(`\nИтого новых снимков: ${m.reduce((n, p) => n + p.images.length, 0) + b.length}`);
})();
