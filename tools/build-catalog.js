// Сборка каталога: авторские данные (data/catalog-meta.js) + снимки
// (data/photos-index.json) → data/catalog.json, который читают и сайт, и админка.
//
// Здесь же готовится всё, что нужно фильтрам: списки категорий, планировок,
// стилей и гамм считаются из фактических данных, а не задаются руками —
// иначе они разъезжаются при первой же правке каталога.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const meta = require(path.join(ROOT, 'data', 'catalog-meta.js'));
const photos = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'photos-index.json'), 'utf8'));

// Порядок категорий в меню и на странице каталога. Задан вручную:
// по количеству товаров кухни всё равно первые, но остальные должны идти
// в осмысленном порядке, а не по алфавиту.
const ПОРЯДОК = ['Кухни', 'Шкафы и гардеробные', 'Гостиные', 'Спальни', 'Прихожие', 'Детские', 'Столы'];

// Транслит для адресов: латиница в URL надёжнее — кириллица в ссылке
// превращается в процентную кашу при копировании.
const ТАБЛИЦА = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',
  ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',' ':'-','-':'-',
};
const slug = s => [...s.toLowerCase()].map(c => ТАБЛИЦА[c] ?? (/[a-z0-9]/.test(c) ? c : '')).join('')
  .replace(/-+/g, '-').replace(/^-|-$/g, '');

const проблемы = [];

const products = meta.map((m, i) => {
  const рек = photos[m.uid];
  if (!рек) { проблемы.push(`${m.name}: нет записи о снимках (uid ${m.uid})`); return null; }

  let ph = рек.photos || [];
  if (!ph.length) { проблемы.push(`${m.name}: нет снимков`); return null; }

  // cover — если первый по порядку кадр неудачен (строительный мусор,
  // полуразобранная мебель), обложкой становится другой
  if (m.cover != null) {
    if (m.cover >= ph.length) проблемы.push(`${m.name}: обложка ${m.cover}, а кадров ${ph.length}`);
    else ph = [ph[m.cover], ...ph.filter((_, k) => k !== m.cover)];
  }

  if (!ПОРЯДОК.includes(m.cat)) проблемы.push(`${m.name}: неизвестная категория «${m.cat}»`);
  if (!m.text || m.text.length < 80) проблемы.push(`${m.name}: описание слишком короткое`);
  if (!m.items || m.items.length < 2) проблемы.push(`${m.name}: состав почти пуст`);

  return {
    id: m.uid,
    slug: slug(m.name),
    name: m.name,
    category: m.cat,
    layout: m.layout,
    style: m.style,
    palette: m.palette,
    items: m.items,
    short: m.short,
    text: m.text,
    // Цены пока нет: продаём по договорной. Поле заведено заранее, чтобы
    // включить показ цен можно было без переделки данных и вёрстки.
    price: null,
    priceUnit: null,
    order: i,
    photos: ph.map(p => ({ full: p.full, card: p.card })),
  };
}).filter(Boolean);

// Адреса товаров обязаны быть уникальны — иначе одна карточка перекроет другую
const адреса = products.map(p => p.slug);
const дубли = [...new Set(адреса.filter((s, i) => адреса.indexOf(s) !== i))];
if (дубли.length) проблемы.push(`повторяющиеся адреса: ${дубли.join(', ')}`);

products.sort((a, b) => {
  const d = ПОРЯДОК.indexOf(a.category) - ПОРЯДОК.indexOf(b.category);
  return d || a.order - b.order;
});

const собрать = ключ => {
  const счёт = {};
  products.forEach(p => { if (p[ключ]) счёт[p[ключ]] = (счёт[p[ключ]] || 0) + 1; });
  return Object.entries(счёт).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
};

const категории = ПОРЯДОК
  .map(c => ({
    name: c,
    slug: slug(c),
    count: products.filter(p => p.category === c).length,
    cover: products.find(p => p.category === c)?.photos[0].card || null,
  }))
  .filter(c => c.count);

const каталог = {
  generated: new Date().toISOString(),
  categories: категории,
  filters: { layout: собрать('layout'), style: собрать('style'), palette: собрать('palette') },
  products,
};

fs.writeFileSync(path.join(ROOT, 'data', 'catalog.json'), JSON.stringify(каталог, null, 2), 'utf8');
// Сайт читает каталог из public — так его отдаёт и локальный сервер, и хостинг
fs.mkdirSync(path.join(ROOT, 'public', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public', 'data', 'catalog.json'), JSON.stringify(каталог), 'utf8');

console.log('Категория'.padEnd(24), 'товаров'.padStart(8), 'фото'.padStart(6));
категории.forEach(c => {
  const ф = products.filter(p => p.category === c.name).reduce((n, p) => n + p.photos.length, 0);
  console.log(c.name.padEnd(24), String(c.count).padStart(8), String(ф).padStart(6));
});
console.log(`\nВсего: ${products.length} товаров, ${products.reduce((n, p) => n + p.photos.length, 0)} фото`);
console.log('Планировки:', каталог.filters.layout.map(f => `${f.value} ${f.count}`).join(', '));
console.log('Стили:     ', каталог.filters.style.map(f => `${f.value} ${f.count}`).join(', '));
console.log('Гаммы:     ', каталог.filters.palette.map(f => `${f.value} ${f.count}`).join(', '));

const весКб = (fs.statSync(path.join(ROOT, 'public', 'data', 'catalog.json')).size / 1024).toFixed(0);
console.log(`Файл каталога для сайта: ${весКб} КБ`);

if (проблемы.length) { console.log(`\nПроблемы (${проблемы.length}):`); проблемы.forEach(x => console.log('  ' + x)); }
else console.log('\nПроблем не найдено.');
