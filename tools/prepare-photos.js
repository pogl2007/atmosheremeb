// Единая подготовка снимков по всем источникам.
//
// Заменяет прежний fetch-catalog-photos.js, который умел только один источник.
// Оригиналы кэшируются в data/photos-src и повторно не качаются, поэтому
// параметры грейда можно крутить без обращения к сети.
//
// Формат — AVIF без запасного WebP. На наших снимках он даёт тот же вид
// при вдвое меньшем весе (обложка 44.8 КБ → 20.6 КБ). Плата за это:
// Safari научился читать AVIF только с 16.4 (март 2023), и на более
// старых айфонах картинки не покажутся вообще. Решение осознанное,
// приоритет отдан экономии места.
//
// Качество разное по назначению: обложка карточки мелкая, ей хватает 45;
// снимок в галерее открывается на 1400 px, там ставим 50.
//
// Мелкие картинки отсеиваются здесь же: у Tilda в разметку попадают иконки и
// элементы оформления, они приезжают вместе с фотографиями товаров.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ProxyAgent, setGlobalDispatcher } = require('undici');

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                 process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'photos-src');
const OUT = path.join(ROOT, 'public', 'img', 'catalog');
const INDEX = path.join(ROOT, 'data', 'photos-index.json');

// Тёплый грейд под палитру сайта (беж #F1E4D2, шоколад #2D231B).
// Серый 120 уходит примерно в 126/120/112: сдвиг виден, белые фасады не желтеют.
const WARM_MUL = [1.045, 1.005, 0.945];
const WARM_OFF = [3, 1, -2];
const SATURATION = 1.04;

const FULL_MAX = 1400;
const CARD_W = 800, CARD_H = 1000;
const PARALLEL = 4;
const МИН_СТОРОНА = 500;   // меньше — это иконка или элемент оформления

// toColourspace обязателен: среди исходников попадаются одноканальные
// (в оттенках серого), а поканальный linear на них падает.
const warm = img => img.toColourspace('srgb')
  .linear(WARM_MUL, WARM_OFF).modulate({ saturation: SATURATION });

// Все источники приводим к одной форме: uid, имя, разделы, images[]
function собратьЗадачи() {
  const позиции = [];

  const modus = path.join(ROOT, 'data', 'modus-raw.json');
  if (fs.existsSync(modus)) {
    JSON.parse(fs.readFileSync(modus, 'utf8')).forEach(p => позиции.push({
      источник: 'modus', uid: p.uid, имя: p.title,
      разделы: [], images: p.images,
    }));
  }

  const dir = path.join(ROOT, 'data', 'sources');
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
      JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).forEach(p => позиции.push(p));
    });
  }

  const jobs = [];
  позиции.forEach(p => p.images.forEach((url, n) => {
    const ext = (url.match(/\.(jpg|jpeg|png|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase();
    jobs.push({
      источник: p.источник, uid: p.uid, имя: p.имя, разделы: p.разделы, n, url,
      src: path.join(SRC, `${p.uid}-${n}.${ext}`),
      full: path.join(OUT, `${p.uid}-${n}.avif`),
      card: path.join(OUT, `${p.uid}-${n}-card.avif`),
    });
  }));
  return jobs;
}

async function скачать(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function партиями(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

(async () => {
  fs.mkdirSync(SRC, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const jobs = собратьЗадачи();
  const поИсточникам = {};
  jobs.forEach(j => поИсточникам[j.источник] = (поИсточникам[j.источник] || 0) + 1);
  console.log('Снимков по источникам:');
  Object.entries(поИсточникам).forEach(([k, v]) => console.log(`  ${k.padEnd(10)} ${v}`));
  console.log(`  всего      ${jobs.length}\n`);

  let новых = 0, кэш = 0;
  const битые = [];

  // Две попытки: прокси иногда роняет часть параллельных запросов
  for (const попытка of [1, 2]) {
    const надо = jobs.filter(j => !fs.existsSync(j.src) || fs.statSync(j.src).size === 0);
    if (!надо.length) break;
    if (попытка === 2) console.log(`Повтор для ${надо.length} снимков…`);
    await партиями(надо, PARALLEL, async job => {
      try { (await скачать(job.url, job.src)) ? новых++ : кэш++; }
      catch (e) { if (попытка === 2) битые.push({ job, why: e.message }); }
    });
  }
  кэш = jobs.filter(j => fs.existsSync(j.src)).length - новых;
  console.log(`Загружено: ${новых} новых, ${кэш} из кэша, не удалось ${битые.length}`);

  let обработано = 0, мелких = 0;
  const index = {};

  await партиями(jobs.filter(j => fs.existsSync(j.src)), PARALLEL, async job => {
    try {
      const meta = await sharp(job.src).metadata();
      if (Math.min(meta.width, meta.height) < МИН_СТОРОНА) { мелких++; return; }

      // Одноканальные (в оттенках серого) поканальный linear не принимает:
      // sharp применяет операции в своём порядке, и toColourspace в той же
      // цепочке не успевает развернуть каналы. Разворачиваем отдельным проходом.
      const вход = meta.channels < 3
        ? await sharp(job.src).toColourspace('srgb').png().toBuffer()
        : job.src;

      await warm(sharp(вход).rotate())
        .resize(FULL_MAX, FULL_MAX, { fit: 'inside', withoutEnlargement: true })
        .avif({ quality: 50 }).toFile(job.full);

      await warm(sharp(вход).rotate())
        .resize(CARD_W, CARD_H, { fit: 'cover', position: 'attention' })
        .avif({ quality: 45 }).toFile(job.card);

      const рек = index[job.uid] = index[job.uid] ||
        { источник: job.источник, имя: job.имя, разделы: job.разделы, photos: [] };
      рек.photos.push({
        n: job.n,
        full: path.posix.join('img', 'catalog', path.basename(job.full)),
        card: path.posix.join('img', 'catalog', path.basename(job.card)),
        w: meta.width, h: meta.height,
      });
      обработано++;
    } catch (e) { битые.push({ job, why: e.message }); }
  });

  Object.values(index).forEach(v => v.photos.sort((a, b) => a.n - b.n));
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');

  const вес = (список, ключ) => список.filter(j => fs.existsSync(j[ключ]))
    .reduce((s, j) => s + fs.statSync(j[ключ]).size, 0) / 1048576;

  console.log(`Обработано: ${обработано}, отсеяно мелких: ${мелких}`);
  console.log(`Оригиналы: ${вес(jobs, 'src').toFixed(1)} МБ`);
  console.log(`Галерея:   ${вес(jobs, 'full').toFixed(1)} МБ`);
  console.log(`Обложки:   ${вес(jobs, 'card').toFixed(1)} МБ`);
  console.log(`Позиций с фото: ${Object.keys(index).length}`);
  if (битые.length) {
    console.log(`\nНе получилось (${битые.length}):`);
    битые.slice(0, 12).forEach(b => console.log(`  ${b.job.uid} #${b.job.n} — ${b.why}`));
  }
})();
