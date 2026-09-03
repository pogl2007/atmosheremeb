// Контактные листы по источнику: node tools/sheets.js mkbastet
//
// Нужны, чтобы (1) выбраковать не-мебель — у Tilda в разметку попадают
// элементы оформления, и (2) писать описания по тому, что реально на снимке.
// Подпись плитки — uid, по нему позиция ищется в data/photos-index.json.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const источник = process.argv[2];
if (!источник) { console.error('укажите источник: modus | mebnika | mkbastet'); process.exit(1); }

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'photos-index.json'), 'utf8'));
const позиции = Object.entries(index)
  .filter(([, v]) => v.источник === источник)
  .map(([uid, v]) => ({ uid, имя: v.имя, разделы: v.разделы || [], photos: v.photos }));

const COLS = 5, ROWS = 3, TW = 250, TH = 312, PAD = 24;
const НА_ЛИСТЕ = COLS * ROWS;

(async () => {
  const dir = path.join(ROOT, 'data', 'sheets', источник);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  for (let i = 0, лист = 0; i < позиции.length; i += НА_ЛИСТЕ) {
    лист++;
    const кусок = позиции.slice(i, i + НА_ЛИСТЕ);
    const W = COLS * TW, H = ROWS * (TH + PAD);
    const слои = [];

    for (let k = 0; k < кусок.length; k++) {
      const p = кусок[k];
      const x = (k % COLS) * TW, y = Math.floor(k / COLS) * (TH + PAD);

      слои.push({
        input: await sharp(path.join(ROOT, 'public', p.photos[0].card))
          .resize(TW - 6, TH - 6, { fit: 'cover' }).toBuffer(),
        left: x + 3, top: y + PAD,
      });

      const подпись = `${p.uid} ${p.имя || p.разделы[0] || ''}`.trim().slice(0, 30);
      слои.push({
        input: Buffer.from(
          `<svg width="${TW}" height="${PAD}">
             <rect width="100%" height="100%" fill="#1a1410"/>
             <text x="5" y="17" font-family="sans-serif" font-size="13"
                   fill="#F1E4D2">${подпись.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
           </svg>`),
        left: x, top: y,
      });
    }

    await sharp({ create: { width: W, height: H, channels: 3, background: { r: 26, g: 20, b: 16 } } })
      .composite(слои).jpeg({ quality: 84 })
      .toFile(path.join(dir, `${лист}.jpg`));
  }

  console.log(`${источник}: позиций ${позиции.length}, листов ${Math.ceil(позиции.length / НА_ЛИСТЕ)}`);
})();
