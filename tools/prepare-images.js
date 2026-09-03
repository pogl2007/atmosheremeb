// Готовит кадры для скролл-анимации:
// 1) убирает значок генератора в правом нижнем углу (заливка фоном по краям области),
// 2) конвертирует в AVIF,
// 3) раскладывает по порядку сборки комнаты room-0 … room-6.
//
// Порядок задан вручную: автоматическая сортировка по «отличию от пустой комнаты»
// путает шаги 4 и 5 (ТВ-тумба и ковёр дают почти одинаковую разницу).

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'image');
const OUT = path.join(__dirname, '..', 'public', 'img');

const ORDER = [
  ['746e543d-e8e8-47bf-b5d0-334451514e0a.jpg', 'пустая комната'],
  ['767f4476-0236-4495-88af-d8602eeca4ca.jpg', '+ диван'],
  ['25d19e69-2846-4e4f-8223-a020f3028eb6.jpg', '+ кресло'],
  ['53ad3287-c54e-4894-9843-5020bd2e73bc.jpg', '+ журнальный стол'],
  ['90d30c4a-b47e-4d9a-969b-1ab3c401a5d9.jpg', '+ ТВ-тумба'],
  ['2ea86cc9-b96d-408e-b37b-3f663d2383fa.jpg', '+ ковёр'],
  ['1577f087-87f7-4859-a25a-df224cdc3ea0.jpg', '+ торшер, растение, картина'],
];

// Область значка с запасом (в долях от стороны — не зависит от разрешения)
const MARK = { x0: 0.845, y0: 0.845, x1: 0.920, y1: 0.920 };

// Цвет фона секции на сайте. К нему приводим фон всех кадров, иначе:
//  — виден край картинки (у кадров фон 34, 32, 27… — у каждого свой);
//  — при перелистывании фон «дышит», потому что яркость скачет между кадрами.
// Тёмный шоколад #2E231C — тот же цвет, что у полосы с цифрами под секцией.
// Благодаря этому стык двух секций не виден вообще: цвет буквально один и тот же.
const BG = [46, 35, 28];

// Комната занимает 14.7%..85.2% по X и 16.6%..88.7% по Y, то есть край кадра
// от неё далеко — можно спокойно растворять начиная с 0.82 (в мере Чебышёва).
const FEATHER_FROM = 0.82;
const FEATHER_TO = 0.99;

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Уровень фона кадра — медиана яркости верхней полосы (там только фон)
function backgroundLevel(data, W, H, ch) {
  const vals = [];
  for (let y = 0; y < Math.floor(H * 0.12); y += 2)
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * ch;
      vals.push((data[i] + data[i + 1] + data[i + 2]) / 3);
    }
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

// 1) подтягиваем уровень фона к BG, не трогая комнату и тёплое свечение;
// 2) у самых краёв доводим до BG точно, чтобы граница кадра исчезла.
function normalizeBackground(data, W, H, ch) {
  const level = backgroundLevel(data, W, H, ch);
  // Сдвиг считаем отдельно по каждому каналу: фон исходников нейтрально-серый,
  // а привести его нужно к цветному. Общий сдвиг дал бы серый, а не шоколад.
  const offset = [BG[0] - level, BG[1] - level, BG[2] - level];

  for (let y = 0; y < H; y++) {
    const dy = Math.abs(y / H - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;

      // насколько пиксель «фоновый»: у фона вес 1, у комнаты и свечения — 0
      const wBg = 1 - smoothstep(level + 6, level + 26, lum);
      // насколько пиксель близок к краю кадра
      const dx = Math.abs(x / W - 0.5) * 2;
      const wEdge = smoothstep(FEATHER_FROM, FEATHER_TO, Math.max(dx, dy));

      for (let c = 0; c < 3; c++) {
        const shifted = data[i + c] + offset[c] * wBg;
        const v = shifted * (1 - wEdge) + BG[c] * wEdge;
        data[i + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  return level;
}

// Заливка области билинейной интерполяцией от её краёв.
// Фон вокруг значка — плавный градиент без деталей, поэтому шов не виден.
function inpaint(data, W, H, ch, box) {
  const { x0, y0, x1, y1 } = box;
  const px = (x, y, c) => data[(y * W + x) * ch + c];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const fx = (x - x0 + 1) / (x1 - x0 + 2);
      const fy = (y - y0 + 1) / (y1 - y0 + 2);
      for (let c = 0; c < ch; c++) {
        const left = px(x0 - 1, y, c), right = px(x1 + 1, y, c);
        const top = px(x, y0 - 1, c), bottom = px(x, y1 + 1, c);
        const h = left * (1 - fx) + right * fx;
        const v = top * (1 - fy) + bottom * fy;
        data[(y * W + x) * ch + c] = Math.round((h + v) / 2);
      }
    }
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  for (let i = 0; i < ORDER.length; i++) {
    const [file, label] = ORDER[i];
    const src = path.join(SRC, file);
    if (!fs.existsSync(src)) { console.error('НЕТ ФАЙЛА:', file); continue; }

    const { data, info } = await sharp(src)
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: ch } = info;

    inpaint(data, W, H, ch, {
      x0: Math.round(W * MARK.x0), y0: Math.round(H * MARK.y0),
      x1: Math.round(W * MARK.x1), y1: Math.round(H * MARK.y1),
    });

    const level = normalizeBackground(data, W, H, ch);

    const outFile = path.join(OUT, `room-${i}.avif`);
    // Тёмный градиент склонен к полосам, поэтому качество выше и без субсэмплинга цвета
    await sharp(data, { raw: { width: W, height: H, channels: ch } })
      .avif({ quality: 50 })
      .toFile(outFile);

    const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
    console.log(`room-${i}.avif  ${String(kb).padStart(4)} KB  фон был ${level.toFixed(1)} → ${BG[0]}  ← ${label}`);
  }

  console.log('\nГотово. Исходники остались в public/image/');
})();
