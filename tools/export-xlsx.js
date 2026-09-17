// Таблица всех товаров для заказчика: и видимых, и скрытых.
//
// Берёт data/catalog-all.json (его пишет build-catalog.js), поэтому сначала
// собирается каталог. В каждой строке — миниатюра, чтобы модель находилась
// глазами, а не только по названию. Фильтры и закреплённая шапка включены.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const все = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog-all.json'), 'utf8'));
const индекс = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'photos-index.json'), 'utf8'));
const modus = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'modus-raw.json'), 'utf8')).map(p => [p.uid, p]));
const ВЫХОД = process.argv[2] || path.join(ROOT, 'atmosfera-katalog-tovary.xlsx');

const ПОСТАВЩИК = { modus: 'Модус (modus-mebel.ru)', mebnika: 'Мебника (mebnika.ru)', mkbastet: 'Бастет (mkbastet.ru)' };
const ПОРЯДОК = ['Кухни', 'Шкафы и гардеробные', 'Гостиные', 'Спальни', 'Прихожие', 'Детские', 'Столы'];

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Товары', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '№', key: 'n', width: 5 },
    { header: 'Фото', key: 'img', width: 17 },
    { header: 'Название', key: 'name', width: 18 },
    { header: 'Раздел', key: 'cat', width: 20 },
    { header: 'На сайте', key: 'vis', width: 11 },
    { header: 'Планировка / тип', key: 'layout', width: 16 },
    { header: 'Стиль', key: 'style', width: 13 },
    { header: 'Гамма', key: 'palette', width: 12 },
    { header: 'Кратко', key: 'short', width: 42 },
    { header: 'Что входит', key: 'items', width: 48 },
    { header: 'Поставщик', key: 'src', width: 22 },
    { header: 'Название у поставщика', key: 'srcName', width: 22 },
    { header: 'Страница на сайте', key: 'url', width: 40 },
    { header: 'Страница у поставщика', key: 'srcUrl', width: 40 },
    { header: 'Фото, шт', key: 'photos', width: 9 },
    { header: 'Код', key: 'id', width: 15 },
  ];

  const шапка = ws.getRow(1);
  шапка.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  шапка.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D231B' } };
  шапка.alignment = { vertical: 'middle', wrapText: true };
  шапка.height = 30;

  const список = [...все].sort((a, b) =>
    ПОРЯДОК.indexOf(a.category) - ПОРЯДОК.indexOf(b.category) ||
    (b.visible - a.visible) || a.name.localeCompare(b.name, 'ru'));

  for (const [i, p] of список.entries()) {
    const исх = индекс[p.id] || {};
    const м = modus[p.id];
    const row = ws.addRow({
      n: i + 1,
      name: p.name,
      cat: p.category,
      vis: p.visible ? 'да' : 'скрыт',
      layout: p.layout, style: p.style, palette: p.palette,
      short: p.short,
      items: (p.items || []).join(', '),
      src: ПОСТАВЩИК[p.source] || p.source,
      srcName: исх.имя || '',
      url: p.visible ? { text: `atmospheremeb.ru/product/${p.slug}/`, hyperlink: `https://atmospheremeb.ru/product/${p.slug}/` } : '—',
      srcUrl: м?.url ? { text: м.url.replace('https://', ''), hyperlink: м.url } : '',
      photos: p.photos.length,
      id: p.id,
    });
    row.height = 70;
    row.alignment = { vertical: 'middle', wrapText: true };
    row.getCell('vis').font = { bold: true, color: { argb: p.visible ? 'FF2E7D32' : 'FF9E9E9E' } };
    if (!p.visible) row.getCell('name').font = { color: { argb: 'FF757575' } };
    ['url', 'srcUrl'].forEach(k => { if (row.getCell(k).value?.hyperlink) row.getCell(k).font = { color: { argb: 'FF1565C0' }, underline: true }; });

    const файл = path.join(ROOT, 'public', p.photos[0].card);
    if (fs.existsSync(файл)) {
      const buf = await sharp(файл).resize(120, 90, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
      const id = wb.addImage({ buffer: buf, extension: 'jpeg' });
      ws.addImage(id, { tl: { col: 1.05, row: i + 1.05 }, ext: { width: 112, height: 84 } });
    }
  }

  ws.autoFilter = { from: 'A1', to: 'P1' };

  // Второй лист — сводка по разделам
  const св = wb.addWorksheet('Сводка');
  св.columns = [{ header: 'Раздел', key: 'c', width: 24 }, { header: 'На сайте', key: 'v', width: 11 },
                { header: 'Скрыто', key: 'h', width: 10 }, { header: 'Всего', key: 't', width: 10 }];
  св.getRow(1).font = { bold: true };
  ПОРЯДОК.forEach(c => {
    const в = все.filter(p => p.category === c);
    св.addRow({ c, v: в.filter(p => p.visible).length, h: в.filter(p => !p.visible).length, t: в.length });
  });
  св.addRow({ c: 'Итого', v: все.filter(p => p.visible).length, h: все.filter(p => !p.visible).length, t: все.length }).font = { bold: true };

  await wb.xlsx.writeFile(ВЫХОД);
  console.log(`Товаров: ${все.length} (на сайте ${все.filter(p => p.visible).length}) → ${ВЫХОД}`);
})();
