// Собирает контактные листы обложек, чтобы описания к товарам писались
// по тому, что реально на снимке, а не по фантазии.
//
// Каждая плитка подписана номером — он же порядковый номер товара в
// data/catalog-order.json, так что подписи невозможно перепутать местами.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'modus-raw.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'photos-index.json'), 'utf8'));

const категория = t =>
  /^Кухня/i.test(t) ? 'Кухня' :
  /^(Шкаф|Гардеробная)/i.test(t) ? 'Шкафы и гардеробные' :
  /^Прихожая/i.test(t) ? 'Прихожая' :
  /^Гостиная/i.test(t) ? 'Гостиная' :
  /^Спальня/i.test(t) ? 'Спальня' :
  /^Детская/i.test(t) ? 'Детская' :
  /^Ванная/i.test(t) ? 'Ванная' : 'прочее';

// Ванные в каталог не берём — заказчик их не выбрал
const товары = raw
  .filter(p => категория(p.title) !== 'Ванная')
  .map(p => ({ uid: p.uid, исходное: p.title, категория: категория(p.title),
               фото: idx[p.uid]?.photos || [] }))
  .filter(p => p.фото.length);

// Фиксируем порядок: на него ссылаются номера на листах
товары.forEach((t, i) => { t.n = i + 1; });
fs.writeFileSync(path.join(ROOT, 'data', 'catalog-order.json'),
  JSON.stringify(товары, null, 2), 'utf8');

const COLS = 4, ROWS = 2, TW = 300, TH = 375, PAD = 28;
const НА_ЛИСТЕ = COLS * ROWS;

(async () => {
  fs.mkdirSync(path.join(ROOT, 'data', 'sheets'), { recursive: true });
  let лист = 0;

  for (let i = 0; i < товары.length; i += НА_ЛИСТЕ) {
    лист++;
    const кусок = товары.slice(i, i + НА_ЛИСТЕ);
    const W = COLS * TW, H = ROWS * (TH + PAD);
    const слои = [];

    for (let k = 0; k < кусок.length; k++) {
      const t = кусок[k];
      const col = k % COLS, row = Math.floor(k / COLS);
      const x = col * TW, y = row * (TH + PAD);

      слои.push({
        input: await sharp(path.join(ROOT, 'public', t.фото[0].card))
          .resize(TW - 8, TH - 8, { fit: 'cover' }).toBuffer(),
        left: x + 4, top: y + PAD,
      });

      const подпись = `${t.n}. ${t.исходное} (${t.фото.length} фото)`;
      слои.push({
        input: Buffer.from(
          `<svg width="${TW}" height="${PAD}">
             <rect width="100%" height="100%" fill="#1a1410"/>
             <text x="6" y="19" font-family="sans-serif" font-size="15"
                   fill="#F1E4D2">${подпись.replace(/&/g, '&amp;')}</text>
           </svg>`),
        left: x, top: y,
      });
    }

    const файл = path.join(ROOT, 'data', 'sheets', `sheet-${лист}.jpg`);
    await sharp({ create: { width: W, height: H, channels: 3,
                            background: { r: 26, g: 20, b: 16 } } })
      .composite(слои).jpeg({ quality: 86 }).toFile(файл);
    console.log(`лист ${лист}: товары ${кусок[0].n}–${кусок[кусок.length - 1].n}`);
  }

  console.log(`\nВсего товаров: ${товары.length}, листов: ${лист}`);
})();
