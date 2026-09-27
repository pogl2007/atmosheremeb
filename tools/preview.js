// Предпросмотр собранного сайта на своей машине: node tools/preview.js
//
// Раздаёт public/ так же, как nginx на сервере, и больше ничего не делает.
// Раньше для этого был server.js — вторая, упрощённая копия бекенда на
// Express: сам слал заявки в Telegram с настоящим токеном из .env, писал
// журнал с телефонами внутрь public (и отдавал его по прямой ссылке),
// а его проверки полей со временем разошлись с настоящими. Бекенд один —
// backend/ на Go, у него есть тесты (cd backend && go test ./...).
//
// Здесь /api/* отвечает «недоступно», и сайт ведёт себя как при сбое
// сервера: чат отвечает заготовками, формы показывают ошибку. Заявки
// с предпросмотра никуда не уходят — и это намеренно.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const ДАННЫЕ = path.join(ROOT, 'build-data');
const PORT = Number(process.env.PORT) || 3000;

// Та же политика, что в deploy/nginx-security.conf: если новый код нарушит её
// (onclick в разметке, скрипт с чужого адреса), это видно здесь, в консоли
// браузера, а не после выкладки
const CSP = fs.readFileSync(path.join(ROOT, 'deploy', 'nginx-security.conf'), 'utf8')
  .match(/Content-Security-Policy "([^"]+)"/)[1];

const ТИПЫ = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function отдатьФайл(res, файл, код = 200) {
  fs.readFile(файл, (err, данные) => {
    if (err) return ненайдено(res);
    res.writeHead(код, {
      'Content-Type': ТИПЫ[path.extname(файл)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
    });
    res.end(данные);
  });
}

function ненайдено(res) {
  fs.readFile(path.join(PUB, '404.html'), (err, данные) => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(err ? 'Не найдено' : данные);
  });
}

http.createServer((req, res) => {
  let адрес;
  try {
    адрес = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400); return res.end();
  }

  if (адрес.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: 'Предпросмотр: сервер заявок не запущен' }));
  }

  // Правки из админки и статьи — то, что на сервере отдаёт бекенд
  if (адрес === '/data/overrides.json' || адрес === '/data/blog.json') {
    return отдатьФайл(res, path.join(ДАННЫЕ, path.basename(адрес)));
  }

  // path.join схлопывает «..», но проверяем итог явно: файл обязан лежать в public
  let файл = path.join(PUB, адрес);
  if (файл !== PUB && !файл.startsWith(PUB + path.sep)) return ненайдено(res);
  if (адрес.endsWith('/')) файл = path.join(файл, 'index.html');

  fs.stat(файл, (err, st) => {
    if (!err && st.isDirectory()) {
      res.writeHead(301, { Location: адрес + '/' });
      return res.end();
    }
    if (err) return ненайдено(res);
    отдатьФайл(res, файл);
  });
// Только своя машина: предпросмотр не должен быть виден из общей сети
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Предпросмотр: http://127.0.0.1:${PORT}/  (заявки отсюда не отправляются)`);
});
