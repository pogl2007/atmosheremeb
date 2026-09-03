// Сбор исходных данных каталога-референса (modus-mebel.ru, движок Tilda).
//
// Товары отдаёт публичный API Tilda: getproductslist по uid раздела. Разделы
// подсмотрены в разметке страницы каталога — в вёрстке они лежат в атрибутах
// data-storepart-uid. Обход страниц товаров не нужен: список сразу отдаёт
// галерею, описание и цену.
//
// Скрипт только скачивает и раскладывает JSON. Картинки качает следующий шаг —
// так проще перезапускать разбор, не дёргая сеть лишний раз.

const fs = require('fs');
const path = require('path');
const { ProxyAgent, setGlobalDispatcher } = require('undici');

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                 process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[инфо] через прокси ${proxyUrl}`);
}

// Разделы каталога-источника. Шкафы разложены на подтипы: родительский раздел
// возвращает то же самое, но по подтипам видно назначение изделия.
const PARTS = [
  { uid: '673230222262', name: 'Кухни' },
  { uid: '632961278672', name: 'Шкафы-купе' },
  { uid: '475648068452', name: 'Распашные шкафы' },
  { uid: '547016601082', name: 'Встроенные шкафы' },
  { uid: '427330781142', name: 'Открытые шкафы' },
  { uid: '393082433822', name: 'Гардеробные системы' },
  { uid: '446160247722', name: 'Мебель в прихожую' },
  { uid: '426499438012', name: 'Мебель для гостиной' },
  { uid: '695567890172', name: 'Мебель для ванной' },
  { uid: '219493337592', name: 'Раздел 219493337592' },
  { uid: '516734073552', name: 'Раздел 516734073552' },
];

const API = 'https://store.tildaapi.com/api/getproductslist/';

async function fetchPart(part) {
  const url = `${API}?storepartuid=${part.uid}&getparts=true&getoptions=true` +
              `&slice=1&size=300&c=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.products || [];
}

// Картинки лежат в двух местах: поле gallery и вставки внутри HTML-описания.
function imagesOf(product) {
  const urls = [];
  try {
    JSON.parse(product.gallery || '[]').forEach(g => { if (g.img) urls.push(g.img); });
  } catch { /* битый gallery — не повод падать */ }

  const html = (product.text || '').replace(/\\\//g, '/');
  for (const m of html.matchAll(/https:\/\/[a-z.]*tildacdn\.com\/[^"'\s\\)]+?\.(?:jpg|jpeg|png|webp)/gi)) {
    urls.push(m[0]);
  }
  // Убираем уменьшенные копии: у Tilda это вставка вида /-/resize/20x/
  return [...new Set(urls.map(u => u.replace(/\/-\/[^/]+\/[^/]*\//, '/')))];
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  const byUid = new Map();

  for (const part of PARTS) {
    let items;
    try {
      items = await fetchPart(part);
    } catch (e) {
      console.log(`  ${part.name.padEnd(22)} — не ответил (${e.message})`);
      continue;
    }

    for (const p of items) {
      const uid = String(p.uid);
      if (!byUid.has(uid)) {
        byUid.set(uid, {
          uid,
          title: p.title,
          price: p.price,
          unit: p.unit || '',
          descr: stripHtml(p.descr),
          text: stripHtml(p.text).slice(0, 4000),
          url: p.url || '',
          images: imagesOf(p),
          parts: [],
        });
      }
      byUid.get(uid).parts.push(part.name);
    }
    console.log(`  ${part.name.padEnd(22)} — ${items.length}`);
  }

  const products = [...byUid.values()];
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'modus-raw.json');
  fs.writeFileSync(outFile, JSON.stringify(products, null, 2), 'utf8');

  const photos = products.reduce((n, p) => n + p.images.length, 0);
  const noPhoto = products.filter(p => !p.images.length).length;

  console.log(`\nВсего товаров: ${products.length}`);
  console.log(`Всего фото: ${photos} (в среднем ${(photos / products.length).toFixed(1)} на товар)`);
  if (noPhoto) console.log(`Без единого фото: ${noPhoto}`);
  console.log(`Сохранено: ${path.relative(process.cwd(), outFile)}`);
})();
