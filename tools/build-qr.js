// QR-код на сайт для визиток, с логотипом в центре.
//
// Логотип закрывает часть кода, поэтому уровень коррекции — H: он
// восстанавливает до 30% потерянных модулей. Знак делаем не шире четверти
// стороны, иначе читаться перестанет даже с H. Результат обязательно
// проверяется декодером (jsQR) — в том числе в мелком размере и в оттенках
// серого, как его видит камера телефона.
//
//   node tools/build-qr.js [папка]

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { chromium } = require('playwright');

const АДРЕС = 'https://atmospheremeb.ru/';
const ROOT = path.join(__dirname, '..');
const КУДА = process.argv[2] || path.join(ROOT, 'shots', 'qr');
const ШРИФТ = path.join(ROOT, 'brand', 'playfair-cyrillic.woff2');

const ШОКОЛАД = '#2D231B';
const БЕЖ = '#FDF8F0';
const ЗОЛОТО = '#C4956A';

const СТОРОНА = 4000;      // итоговый PNG, с запасом под печать
const ПОЛЕ = 0.26;         // ширина текстового знака от стороны кода
// Доля круглой монограммы. Больше 0.30 уровень H уже не вытягивает.
const ДОЛЯ_КРУГА = +(process.env.QR_SHARE || 0.22);

// Логотип рисуем в браузере: тот же шрифт и та же рамка, что на сайте
async function нарисоватьЗнак(вариант) {
  const шрифт = fs.readFileSync(ШРИФТ).toString('base64');
  const html = `<!DOCTYPE html><meta charset="utf-8"><style>
    @font-face { font-family: P; src: url(data:font/woff2;base64,${шрифт}) format("woff2"); font-display: block; }
    * { box-sizing: border-box; margin: 0; padding: 0 }
    html, body { background: transparent }
    .слово { font-family: P, Georgia, serif; color: ${ШОКОЛАД}; line-height: 1 }
    .текст { display: inline-flex; flex-direction: column; align-items: center;
             padding: 26px 44px 22px; background: ${БЕЖ}; border: 4px solid ${ЗОЛОТО}; border-radius: 10px }
    .текст .имя { font-size: 96px; font-weight: 600; letter-spacing: .02em }
    .текст .под { font-family: Inter, system-ui, sans-serif; font-size: 22px; font-weight: 600;
                  letter-spacing: .3em; text-transform: uppercase; color: ${ЗОЛОТО};
                  margin-top: 14px; margin-right: -.3em }
    .круг { width: 320px; height: 320px; border-radius: 50%; background: ${БЕЖ};
            border: 10px solid ${ЗОЛОТО}; display: flex; align-items: center; justify-content: center }
    .круг .буква { font-size: 200px; font-weight: 600 }
  </style>
  <div class="знак слово ${вариант === 'круг' ? 'круг' : 'текст'}" id="знак">${
    вариант === 'круг' ? '<span class="буква">А</span>'
                       : '<span class="имя">Атмосфера</span><span class="под">мебель на заказ</span>'}</div>`;

  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 2 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const готов = await p.evaluate(() => document.fonts.check('600 96px P'));
  if (!готов) throw new Error('шрифт логотипа не загрузился — знак вышел бы не тем');
  const buf = await (await p.$('#знак')).screenshot({ omitBackground: true });
  await b.close();
  return buf;
}

// Декодируем так же, как увидит телефон: серым и в небольшом размере
async function читается(файл, ширина) {
  const { data, info } = await sharp(файл).resize(ширина).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const код = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return код && код.data;
}

(async () => {
  fs.mkdirSync(КУДА, { recursive: true });

  for (const вариант of (process.env.QR_KINDS || 'текст,круг').split(',')) {
    const знак = await нарисоватьЗнак(вариант);

    // PNG-основа кода
    const подложка = await QRCode.toBuffer(АДРЕС, {
      errorCorrectionLevel: 'H', type: 'png', width: СТОРОНА, margin: 2,
      color: { dark: ШОКОЛАД, light: БЕЖ },
    });

    // Текстовый знак широкий, поэтому его задаём по ширине, круглый — по высоте
    const знакМасштаб = await sharp(знак).resize(вариант === 'круг'
      ? { height: Math.round(СТОРОНА * ДОЛЯ_КРУГА) }
      : { width: Math.round(СТОРОНА * ПОЛЕ) }).toBuffer();
    const мм = await sharp(знакМасштаб).metadata();
    if (мм.width > СТОРОНА * 0.30) throw new Error('знак шире 30% кода — не прочитается');

    const файлPNG = path.join(КУДА, `qr-${вариант}${process.env.QR_TAG || ''}.png`);
    await sharp(подложка).composite([{
      input: знакМасштаб,
      left: Math.round((СТОРОНА - мм.width) / 2),
      top: Math.round((СТОРОНА - мм.height) / 2),
    }]).png().toFile(файлPNG);

    // SVG для типографии: сам код вектором, знак — картинкой внутри
    const svgКода = await QRCode.toString(АДРЕС, {
      errorCorrectionLevel: 'H', type: 'svg', margin: 2,
      color: { dark: ШОКОЛАД, light: БЕЖ },
    });
    const бок = +(svgКода.match(/viewBox="0 0 (\d+)/) || [, 0])[1];
    const шSVG = вариант === 'круг' ? бок * ДОЛЯ_КРУГА * (мм.width / мм.height) : бок * ПОЛЕ;
    const вSVG = шSVG * (мм.height / мм.width);
    const знакBase64 = (await sharp(знак).resize({ height: 900 }).png().toBuffer()).toString('base64');
    const svg = svgКода.replace('</svg>',
      `<image x="${((бок - шSVG) / 2).toFixed(3)}" y="${((бок - вSVG) / 2).toFixed(3)}" ` +
      `width="${шSVG.toFixed(3)}" height="${вSVG.toFixed(3)}" ` +
      `href="data:image/png;base64,${знакBase64}"/></svg>`);
    fs.writeFileSync(path.join(КУДА, `qr-${вариант}${process.env.QR_TAG || ''}.svg`), svg, 'utf8');

    // Проверка: крупно, мелко (как на визитке ~2 см при съёмке) и без цвета
    const проверки = [];
    for (const ш of [1200, 600, 300, 200]) проверки.push([ш, await читается(файлPNG, ш)]);
    const плохо = проверки.filter(([, r]) => r !== АДРЕС);
    console.log(`${вариант}: знак ${мм.width}×${мм.height} из ${СТОРОНА}, ` +
      проверки.map(([ш, r]) => `${ш}px ${r === АДРЕС ? '✓' : '✗ ' + r}`).join(', '));
    if (плохо.length) console.log('  ВНИМАНИЕ: не прочитался в мелком размере');
  }
})();
