// Готовит ассеты логотипа из присланных картинок.
//
// Источники — растровые (JPEG), вектора нет. Поэтому знак вырезается из
// самого крупного файла (2048 px) и раскладывается по размерам с запасом
// под экраны с двойной плотностью.
//
// Нужны два варианта знака:
//   logo-mark.png       — тёмно-синий с золотом, для светлых мест (шапка, первый экран)
//   logo-mark-light.png — только золото, для шоколадных секций и подвала
// На тёмном фоне синий контур сливается почти полностью, поэтому одним
// файлом обойтись нельзя.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ВХОД = path.join(ROOT, '..');
const OUT = path.join(ROOT, 'public', 'img');
const BRAND = path.join(ROOT, 'brand', 'new');

const ИСХОДНИКИ = {
  знакБелый: 'Gemini_Generated_Image_so9t5lso9t5lso9t.jpg',  // 2048², знак на белом
  знакСиний: '89345648-5537-4a43-b4a0-11df3e2fbc7a.jpg',      // 1024², знак золотом на синем
  полныйСиний: '20d55f96-7cf6-48c9-ad2d-647cda6f4299.jpg',    // знак + АТМОСФЕРА на синем
  полныйБелый: '5350353e-1d47-46de-8a6c-b02388e2e17c.jpg',    // знак + АТМОСФЕРА + подпись
};

// Убираем фон в прозрачность. Фон плоский, поэтому достаточно порога по
// расстоянию до его цвета; сглаживание по краям сохраняем, иначе линии
// логотипа получаются рваными.
async function убратьФон(вход, фон, допуск = 60) {
  const { data, info } = await sharp(вход).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.from(data);
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.hypot(px[i] - фон[0], px[i + 1] - фон[1], px[i + 2] - фон[2]);
    if (d < допуск) px[i + 3] = 0;
    else if (d < допуск * 2) px[i + 3] = Math.round(255 * (d - допуск) / допуск);
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}


// Перекраска синего в шоколадный.
// Синие пиксели узнаются по преобладанию синего канала над красным —
// у золота наоборот. Светлоту пикселя сохраняем, меняем только оттенок,
// иначе сглаженные края знака превращаются в рваную кромку.
async function вШоколад(вход) {
  const ШОКОЛАД = [45, 35, 27];
  const { data, info } = await sharp(вход).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.from(data);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    if (b <= r + 20) continue;                       // золото и нейтральное не трогаем
    // насколько пиксель тёмный относительно исходного синего
    const k = Math.min(1, (r + g + b) / (0 + 32 + 80));
    px[i]     = Math.round(ШОКОЛАД[0] * k);
    px[i + 1] = Math.round(ШОКОЛАД[1] * k);
    px[i + 2] = Math.round(ШОКОЛАД[2] * k);
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(BRAND, { recursive: true });

  // ── Знак для светлого фона ──
  const белый = await sharp(path.join(ВХОД, ИСХОДНИКИ.знакБелый)).trim({ threshold: 12 }).toBuffer();
  const безФона = await убратьФон(белый, [255, 255, 255], 70);
  const наПрозрачном = await вШоколад(безФона);
  await sharp(наПрозрачном).resize({ height: 160 }).png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'logo-mark.png'));
  await sharp(наПрозрачном).resize({ height: 320 }).png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'logo-mark@2x.png'));

  // ── Знак для тёмного фона: золото на прозрачном ──
  const синий = await sharp(path.join(ВХОД, ИСХОДНИКИ.знакСиний)).trim({ threshold: 12 }).toBuffer();
  const золото = await убратьФон(синий, [11, 34, 76], 70);
  await sharp(золото).resize({ height: 160 }).png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'logo-mark-light.png'));
  await sharp(золото).resize({ height: 320 }).png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'logo-mark-light@2x.png'));

  // ── Превью для соцсетей ──
  // Полный логотип с надписью: там он к месту, размер позволяет прочитать.
  // Синий фон запечён в самой картинке, поэтому перекрашиваем пиксели,
  // а не подложку под ними
  const превьюШоколад = await вШоколад(path.join(ВХОД, ИСХОДНИКИ.полныйСиний));
  await sharp(превьюШоколад)
    .resize(1200, 630, { fit: 'contain', background: { r: 45, g: 35, b: 27 } })
    .jpeg({ quality: 88 })
    .toFile(path.join(ROOT, 'public', 'og-image.jpg'));

  // ── Копии исходников в brand/, чтобы не зависеть от папки «Загрузки» ──
  for (const [имя, файл] of Object.entries(ИСХОДНИКИ)) {
    fs.copyFileSync(path.join(ВХОД, файл), path.join(BRAND, имя + path.extname(файл)));
  }

  const кб = f => (fs.statSync(f).size / 1024).toFixed(1) + ' КБ';
  console.log('Готово:');
  for (const f of ['logo-mark.png', 'logo-mark@2x.png', 'logo-mark-light.png', 'logo-mark-light@2x.png']) {
    const п = path.join(OUT, f);
    const m = await sharp(п).metadata();
    console.log(`  img/${f.padEnd(24)} ${m.width}×${m.height}  ${кб(п)}`);
  }
  for (const f of ['favicon-32.png', 'favicon-512.png', 'apple-touch-icon.png', 'og-image.jpg']) {
    console.log(`  ${f.padEnd(28)} ${кб(path.join(ROOT, 'public', f))}`);
  }
  console.log('\nИсходники скопированы в brand/new/');
})();

/* ══════════ Иконки сайта ══════════

   Полный знак логотипа на 16 пикселях нечитаем: внутри дома диван, кресло,
   две лампы и окно — на такой сетке всё это схлопывается в пятно. Поэтому
   для иконок нарисованы упрощённые версии (brand/icons):

     icon-room.svg — крыша и сплошной диван, читается от 32 px;
     icon-16.svg   — только диван, остаётся чётким и на 16 px.

   Формат .ico позволяет хранить разные картинки для разных размеров, чем
   мы и пользуемся: в выдаче рядом со ссылкой браузер возьмёт 16-й кадр,
   на вкладке — 32-й. Обе версии в одной гамме, поэтому воспринимаются
   как один знак, а не как два разных.

   Заливки сплошные, а не контурные: тонкий контур при уменьшении исчезает
   первым, сплошная фигура держится до последнего. */

const ИКОНКИ = path.join(ROOT, 'brand', 'icons');

async function собратьИконки() {
  const комната = fs.readFileSync(path.join(ИКОНКИ, 'icon-room.svg'));
  const мелкая = fs.readFileSync(path.join(ИКОНКИ, 'icon-16.svg'));

  // PNG-иконки и iOS: везде «комната», размеры позволяют
  for (const s of [32, 48, 96, 192, 512]) {
    await sharp(комната).resize(s, s).png({ compressionLevel: 9 })
      .toFile(path.join(ROOT, 'public', `favicon-${s}.png`));
  }
  await sharp(мелкая).resize(16, 16).png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'public', 'favicon-16.png'));
  await sharp(комната).resize(180, 180).png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'public', 'apple-touch-icon.png'));

  // ── .ico: 16 из «дивана», 32 и 48 из «комнаты» ──
  const кадры = [
    { s: 16, png: await sharp(мелкая).resize(16, 16).png().toBuffer() },
    { s: 32, png: await sharp(комната).resize(32, 32).png().toBuffer() },
    { s: 48, png: await sharp(комната).resize(48, 48).png().toBuffer() },
  ];

  const шапка = Buffer.alloc(6);
  шапка.writeUInt16LE(0, 0);            // зарезервировано
  шапка.writeUInt16LE(1, 2);            // тип: 1 = иконка
  шапка.writeUInt16LE(кадры.length, 4);

  let смещение = 6 + кадры.length * 16;
  const записи = [];
  for (const { s, png } of кадры) {
    const e = Buffer.alloc(16);
    e.writeUInt8(s, 0);                 // ширина
    e.writeUInt8(s, 1);                 // высота
    e.writeUInt8(0, 2);                 // цветов в палитре
    e.writeUInt8(0, 3);                 // зарезервировано
    e.writeUInt16LE(1, 4);              // цветовых плоскостей
    e.writeUInt16LE(32, 6);             // бит на пиксель
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(смещение, 12);
    записи.push(e);
    смещение += png.length;
  }

  const файл = path.join(ROOT, 'public', 'favicon.ico');
  fs.writeFileSync(файл, Buffer.concat([шапка, ...записи, ...кадры.map(k => k.png)]));

  console.log('\nИконки:');
  console.log(`  favicon.ico   16 (диван) + 32, 48 (комната), ${(fs.statSync(файл).size / 1024).toFixed(1)} КБ`);
  for (const f of ['favicon-16.png', 'favicon-32.png', 'favicon-512.png', 'apple-touch-icon.png']) {
    const п = path.join(ROOT, 'public', f);
    console.log(`  ${f.padEnd(22)} ${(fs.statSync(п).size / 1024).toFixed(1)} КБ`);
  }
}

собратьИконки();
