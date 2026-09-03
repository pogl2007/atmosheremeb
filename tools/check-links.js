// Проверка собранного сайта: битые ссылки, отсутствующие картинки,
// дубли адресов, пустые мета-теги.
//
// Работает по файлам на диске, без сети и без запущенного сервера, поэтому
// её можно гонять сразу после сборки.

const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

// Обходим все собранные страницы
function собратьСтраницы(dir = PUB, найдено = []) {
  for (const имя of fs.readdirSync(dir)) {
    const п = path.join(dir, имя);
    const st = fs.statSync(п);
    if (st.isDirectory()) {
      // В эти папки заходить незачем: там ресурсы, а не страницы
      if (['img', 'assets', 'data', 'inc'].includes(имя)) continue;
      собратьСтраницы(п, найдено);
    } else if (имя.endsWith('.html')) {
      // Файлы подтверждения прав для Яндекса и Google — служебные заглушки,
      // у них по определению нет ни заголовка, ни описания
      if (/^(yandex_|google[0-9a-f]{16})/.test(имя)) continue;
      найдено.push(п);
    }
  }
  return найдено;
}

// Адрес → файл на диске. Каталогу соответствует index.html внутри него.
function существует(адрес) {
  const чистый = адрес.split('#')[0].split('?')[0];
  if (!чистый.startsWith('/')) return null;           // внешние и якоря не проверяем
  const п = path.join(PUB, decodeURIComponent(чистый));
  if (fs.existsSync(п)) {
    return fs.statSync(п).isDirectory() ? fs.existsSync(path.join(п, 'index.html')) : true;
  }
  // PHP-страницы существуют как файлы, но локально не исполняются
  return fs.existsSync(п + '.html') ? true : false;
}

const страницы = собратьСтраницы();
const битыеСсылки = [];
const битыеКартинки = [];
const безМеты = [];
const заголовки = new Map();

for (const файл of страницы) {
  const html = fs.readFileSync(файл, 'utf8');
  const адрес = '/' + path.relative(PUB, файл).replace(/\\/g, '/').replace(/index\.html$/, '');

  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const ссылка = m[1];
    if (/^(https?:|mailto:|tel:|#|data:)/.test(ссылка)) continue;
    if (существует(ссылка) === false) битыеСсылки.push(`${адрес} → ${ссылка}`);
  }

  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    const src = m[1];
    if (/^(https?:|data:)/.test(src)) continue;
    if (существует(src) === false) битыеКартинки.push(`${адрес} → ${src}`);
  }

  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
  const descr = (html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1];
  if (!title.trim() || !descr.trim()) безМеты.push(адрес);

  // Одинаковые заголовки у разных страниц — прямая потеря позиций в поиске
  if (title) (заголовки.get(title) || заголовки.set(title, []).get(title)).push(адрес);
}

const дубли = [...заголовки].filter(([, v]) => v.length > 1);

console.log(`Проверено страниц: ${страницы.length}\n`);

const блок = (имя, список) => {
  if (!список.length) { console.log(`${имя}: чисто ✓`); return 0; }
  console.log(`${имя}: ${список.length} ⚠`);
  список.slice(0, 12).forEach(x => console.log('   ' + x));
  if (список.length > 12) console.log(`   … и ещё ${список.length - 12}`);
  return список.length;
};

let проблем = 0;
проблем += блок('Битые ссылки', битыеСсылки);
проблем += блок('Отсутствующие картинки', битыеКартинки);
проблем += блок('Без title или description', безМеты);
проблем += блок('Повторяющиеся заголовки', дубли.map(([t, v]) => `«${t.slice(0, 55)}» — ${v.length} стр.`));

console.log(проблем ? `\nВсего замечаний: ${проблем}` : '\nПроблем не найдено.');
process.exit(проблем ? 1 : 0);
