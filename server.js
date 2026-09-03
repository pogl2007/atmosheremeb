require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { ProxyAgent, setGlobalDispatcher } = require('undici');

// Node's fetch() ignores HTTP_PROXY/HTTPS_PROXY by default — route through it if one is configured.
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[info] Исходящие запросы идут через прокси ${proxyUrl}`);
}

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.warn('[warn] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы в .env — заявки не будут отправляться.');
}

// Лимит поднят: сюда приходит PNG плана комнаты в base64
app.use(express.json({ limit: '4mb' }));
// Express этой версии не знает про AVIF и отдаёт такие файлы как
// application/octet-stream — браузер тогда может их не показать.
// На хостинге то же самое лечится строкой AddType в .htaccess.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, файл) => {
    if (файл.endsWith('.avif')) res.setHeader('Content-Type', 'image/avif');
  },
}));

// ── very small in-memory rate limiter: 5 запросов в минуту с одного IP ──
const hits = new Map();
function isRateLimited(ip, bucket = 'form', max = 5) {
  const now = Date.now();
  const windowMs = 60_000;
  const key = bucket + ':' + ip;
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

const CONTACT_LABELS = { call: 'Позвонить', whatsapp: 'WhatsApp', telegram: 'Telegram', max: 'Max' };

function clean(value, maxLen) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen);
}

// Журнал заявок — его читает админка. Формат JSON Lines: дописывание одной
// строкой атомарно, поэтому две одновременные заявки не портят файл, как
// испортили бы перезапись целого JSON-массива.
//
// В журнале лежат имена и телефоны, то есть персональные данные. Сам файл
// хранится внутри public, потому что на дешёвом хостинге папка выше корня
// сайта часто недоступна на запись. Чтобы его нельзя было скачать по прямой
// ссылке, он назван .php и начинается со строки, обрывающей выполнение:
// при запросе сервер ИСПОЛНИТ файл и не отдаст ни байта содержимого.
// Защита работает, даже если .htaccess почему-то не подхватится.
const ЖУРНАЛ = path.join(__dirname, 'public', 'data', 'orders.log.php');
const ЗАГЛУШКА_ЖУРНАЛА = '<?php http_response_code(404); exit; ?>\n';

function сохранитьЗаявку(запись) {
  try {
    fs.mkdirSync(path.dirname(ЖУРНАЛ), { recursive: true });
    if (!fs.existsSync(ЖУРНАЛ)) fs.writeFileSync(ЖУРНАЛ, ЗАГЛУШКА_ЖУРНАЛА, 'utf8');
    fs.appendFileSync(ЖУРНАЛ, JSON.stringify({ at: new Date().toISOString(), ...запись }) + '\n', 'utf8');
  } catch (e) {
    // Журнал вторичен: заявка уже ушла в Telegram, терять её из-за
    // проблем с диском нельзя
    console.error('[warn] Не удалось записать заявку в журнал:', e.message);
  }
}

function buildConsultMessage(body) {
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 30);
  if (!name || !/^\+7\d{10}$/.test(phone)) return null;

  const city = ['Москва', 'Саратов', 'Рязань'].includes(body.city) ? body.city : clean(body.city, 50) || '—';
  const contact = CONTACT_LABELS[body.contact] || 'Не указано';
  const project = clean(body.project, 80);
  const summary = clean(body.summary, 400);

  const lines = [
    'Новая заявка с сайта',
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    `Город: ${city}`,
    `Связь: ${contact}`,
  ];
  if (project) lines.push(`Источник: ${project}`);
  if (summary) lines.push('', 'О клиенте (о чём спрашивал в чате):', summary);
  return lines.join('\n');
}

// Заявка из корзины. Отдельный сборщик, потому что список позиций
// не помещается в поле «источник» обычной консультации.
function buildOrderMessage(body) {
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 30);
  if (!name || !/^\+7\d{10}$/.test(phone)) return null;

  const contact = CONTACT_LABELS[body.contact] || 'Не указано';
  const позиции = clean(body.project, 1500)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  const lines = [
    'ЗАЯВКА ИЗ КОРЗИНЫ',
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    `Связь: ${contact}`,
    '',
    `Позиций: ${позиции.length}`,
    ...позиции.map((p, i) => `${i + 1}. ${p}`),
  ];
  const summary = clean(body.summary, 400);
  if (summary) lines.push('', summary);
  return lines.join('\n');
}

function buildCityMessage(body) {
  const email = clean(body.email, 200);
  if (!email || !email.includes('@')) return null;
  return `Запрос на новый город\nEmail: ${email}`;
}

app.post('/api/submit', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Слишком много заявок. Попробуйте через минуту.' });
  }

  const body = req.body || {};

  // Honeypot: скрытое поле, которое видят и заполняют только боты.
  if (body.website) {
    return res.json({ ok: true });
  }

  let text;
  if (body.kind === 'consult') text = buildConsultMessage(body);
  else if (body.kind === 'order') text = buildOrderMessage(body);
  else if (body.kind === 'city') text = buildCityMessage(body);
  else return res.status(400).json({ ok: false, error: 'Неизвестный тип заявки' });

  if (!text) {
    return res.status(400).json({ ok: false, error: 'Проверьте правильность заполнения полей' });
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('[error] Заявка не отправлена — нет учётных данных Telegram:', text);
    return res.status(500).json({ ok: false, error: 'Сервис временно недоступен' });
  }

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text })
    });
    const data = await tgRes.json();
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    сохранитьЗаявку({ kind: body.kind, name: body.name, phone: body.phone,
                      contact: body.contact, text });
    res.json({ ok: true });
  } catch (err) {
    console.error('[error] Telegram send failed:', err.message);
    res.status(502).json({ ok: false, error: 'Не удалось отправить заявку, попробуйте позже' });
  }
});

// ── План комнаты картинкой ──
// Приходит PNG в base64, уходит в Telegram отдельным сообщением следом за заявкой.
app.post('/api/plan', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip, 'plan', 5)) return res.json({ ok: false });
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return res.json({ ok: false });

  const body = req.body || {};
  if (body.website) return res.json({ ok: true });   // ловушка для ботов

  const name = clean(body.name, 100);
  const phone = clean(body.phone, 30);
  if (!name || !/^\+7\d{10}$/.test(phone)) {
    return res.status(400).json({ ok: false, error: 'Проверьте имя и телефон' });
  }

  const image = String(body.image || '');
  const m = image.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ ok: false, error: 'Ожидается PNG в base64' });

  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 3_000_000) return res.status(413).json({ ok: false, error: 'Слишком большой файл' });

  // Подпись к снимку — это и есть заявка: у Telegram она видна прямо
  // под картинкой, отдельным сообщением дублировать не нужно.
  const caption = [
    'ПЛАН КОМНАТЫ С САЙТА',
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    `Связь: ${CONTACT_LABELS[body.contact] || 'Не указано'}`,
    `Комната: ${clean(body.room, 40) || '—'}`,
    `Размеры: ${clean(body.size, 40) || '—'}`,
    `Мебель: ${clean(body.items, 400) || '—'}`,
  ].join('\n').slice(0, 1024);   // ограничение Telegram на подпись к фото

  try {
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', caption);
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'plan.png');
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
    const data = await r.json();
    if (!data.ok) throw new Error(data.description || 'Telegram error');
    сохранитьЗаявку({ kind: 'plan', name, phone, contact: body.contact, text: caption });
    res.json({ ok: true });
  } catch (err) {
    console.error('[error] Не удалось отправить план:', err.message);
    res.json({ ok: false });
  }
});

// ── Чат с ИИ-консультантом ──
// Провайдер Nodule работает по OpenAI Responses API (wire_api = "responses"),
// а не по chat/completions. Отличия, из-за которых нельзя взять типовой код:
//   • системный промпт передаётся полем instructions, а не ролью system;
//   • сообщения лежат в input, лимит называется max_output_tokens;
//   • в ответе нет output_text — надо искать в output элемент type: "message",
//     потому что первым идёт элемент reasoning.
// Ключ и адрес живут только здесь, на сервере (.env).
const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL;

// Промпт лежит отдельным файлом, собранным из site/facts.js: тот же файл
// читает PHP на хостинге. Раньше промпт был вписан здесь руками и после
// смены условий работы разъехался с текстами сайта.
const ФАЙЛ_ПРОМПТА = path.join(__dirname, 'public', 'data', 'ai-prompt.txt');
let SYSTEM_PROMPT = '';
try {
  SYSTEM_PROMPT = fs.readFileSync(ФАЙЛ_ПРОМПТА, 'utf8');
} catch (e) {
  console.error('[error] Нет файла промпта. Соберите сайт: node tools/build-site.js');
}

app.post('/api/chat', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  // У чата свой счётчик и лимит выше: переписка — это не отправка заявки
  if (isRateLimited(ip, 'chat', 15)) {
    return res.json({ ok: false, error: 'Слишком много сообщений, подождите минуту.' });
  }
  // Отдаём 200: для сайта это штатный откат на заготовки, а не сбой,
  // и в консоли браузера не копятся красные ошибки.
  if (!AI_API_URL || !AI_API_KEY) {
    return res.json({ ok: false, error: 'AI не настроен' });
  }

  const message = clean(req.body && req.body.message, 500);
  if (!message) return res.status(400).json({ ok: false, error: 'Пустой вопрос' });
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-6).map(h => clean(h, 500)) : [];

  try {
    const r = await fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        instructions: SYSTEM_PROMPT,
        input: [
          ...history.map(h => ({ role: 'user', content: h })),
          { role: 'user', content: message }
        ],
        // Запас нужен с избытком: часть лимита съедают невидимые
        // reasoning-токены, и при нехватке ответ обрывается на полуслове.
        max_output_tokens: 700,
        // Для вопросов с сайта хватает низкого уровня: выше — дольше и дороже.
        reasoning: { effort: 'low' },
        store: false
      })
    });
    const data = await r.json();

    const msg = (data.output || []).find(o => o.type === 'message');
    let answer = msg ? (msg.content || []).map(c => c.text).filter(Boolean).join(' ').trim() : '';
    if (!answer) throw new Error('Нет ответа. status=' + data.status + ' ' + JSON.stringify(data.error || '').slice(0, 150));

    const needsManager = answer.includes('[MANAGER]');
    answer = answer.replace('[MANAGER]', '').trim();
    res.json({ ok: true, answer, needsManager });
  } catch (err) {
    console.error('[error] AI chat failed:', err.message);
    res.json({ ok: false, error: 'AI недоступен' });
  }
});

app.listen(PORT, () => {
  console.log(`Атмосфера Мебель запущена: http://localhost:${PORT}`);
});
