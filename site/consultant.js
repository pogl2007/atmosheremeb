
// ── Консультант: пузырь + чат ──
// Заготовленные ответы по фактам с сайта. Работают всегда, даже если
// ИИ-ответ не пришёл, и гарантированно не выдумывают цены и сроки.
const canned = [
  { q: 'Как проходит заказ?', a: 'Вы оставляете заявку — дизайнер приезжает к вам с образцами материалов и каталогами, делает <b>бесплатный замер</b> и проект. Дальше согласуем смету, подписываем договор и запускаем в работу.' },
  { q: 'Сколько стоит?', a: 'Цена <b>рассчитывается индивидуально</b> под ваш проект, после встречи с дизайнером. В стоимость уже входят выезд замерщика, 3D-проект, доставка до подъезда и подъём на этаж.' },
  { q: 'Какие сроки?', a: 'Изготовление занимает <b>от 7 до 14 рабочих дней</b>. Дизайнер приезжает в течение трёх дней после заявки, в назначенное время.' },
  { q: 'Есть гарантия?', a: '<b>3 года на фасады и фурнитуру.</b> Всё существенное — цвет, материалы, комплектация, сроки и стоимость — фиксируется в договоре.' }
];

const CONSULTANT_DELAY = 15;
const bubble = document.getElementById('cbubble');
const bubbleLabel = document.getElementById('cbubbleLabel');
const bubbleDot = document.getElementById('cbubbleDot');
const panel = document.getElementById('cpanel');
const cbody = document.getElementById('cbody');
let browsingSeconds = 0, bubbleShown = false, chatStarted = false;
let chatHistory = [];
let phoneOffered = false;   // номер уже предлагали оставить
let phoneGiven = false;     // номер оставили — больше не напоминаем
let givenPhone = '';        // на него же уйдёт уточнение про способ связи
let sinceReminder = 0;      // сколько ответов прошло с прошлого напоминания

// Просьбы связаться иначе, чем звонком.
// Границы слова заданы через [^\p{L}], а не \b: в JavaScript \b считает
// словом только латиницу, поэтому «в макс» и «в тг» им не ловятся.
const CONTACT_SWITCH = [
  { re: /(^|[^\p{L}])(макс\p{L}{0,2}|max)([^\p{L}]|$)/iu, value: 'max', name: 'Max' },
  { re: /whats\s*app|вотсап|ватсап|вацап/iu, value: 'whatsapp', name: 'WhatsApp' },
  { re: /телеграм\p{L}*|telegram|(^|[^\p{L}])тг([^\p{L}]|$)/iu, value: 'telegram', name: 'Telegram' },
];

// Сжатая суть переписки — чтобы менеджер сразу видел, о чём человек спрашивал
function chatSummary() {
  if (!chatHistory.length) return '';
  const joined = chatHistory.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
  return joined.length > 400 ? joined.slice(0, 397) + '…' : joined;
}

// Мягкий сигнал через Web Audio — без файла. Браузеры глушат звук, пока
// человек ни разу не кликнул по странице, поэтому оборачиваем в try.
function ding() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [880, 1174].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.11);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.11 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.4);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + i * 0.11); o.stop(now + i * 0.11 + 0.45);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (e) { /* звук не критичен */ }
}

function showBubble() {
  if (bubbleShown) return;
  if (localStorage.getItem('consultantDismissed')) {
    console.info('[консультант] скрыт: вы закрывали его раньше. Сбросить: localStorage.removeItem("consultantDismissed")');
    return;
  }
  bubbleShown = true;
  bubble.classList.add('visible');
  ding();
  setTimeout(() => bubbleLabel.classList.add('hidden'), 8000);
}

function addMsg(text, who) {
  const d = document.createElement('div');
  d.className = 'cmsg ' + who;
  d.innerHTML = text;
  cbody.appendChild(d);
  cbody.scrollTop = cbody.scrollHeight;
  return d;
}

function renderChips() {
  document.getElementById('cchips').innerHTML = canned
    .map((c, i) => '<button type="button" class="cchip" onclick="askCanned(' + i + ')">' + c.q + '</button>')
    .join('');
}

function askCanned(i) {
  addMsg(canned[i].q, 'me');
  setTimeout(() => addMsg(canned[i].a, 'bot'), 260);
}

function openChat() {
  bubble.classList.remove('visible');
  panel.classList.add('open');
  bubbleDot.style.display = 'none';
  if (!chatStarted) {
    chatStarted = true;
    renderChips();
    addMsg('Здравствуйте! Подбираете мебель на заказ? Спрашивайте — расскажу про выезд дизайнера, сроки и условия.', 'bot');
  }
  setTimeout(() => document.getElementById('cinput').focus(), 300);
}

function closeChat() {
  // Чат не исчезает совсем — сворачивается обратно в кружок, чтобы к нему
  // можно было вернуться. Переписка при этом сохраняется.
  panel.classList.remove('open');
  bubble.classList.add('visible');
  bubbleLabel.classList.add('hidden');   // подпись показываем только в первый раз
  bubbleDot.style.display = '';          // точка возвращается — приглашение продолжить
}

async function sendChat(e) {
  e.preventDefault();
  const input = document.getElementById('cinput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg(text.replace(/</g, '&lt;'), 'me');

  // Телефон узнаём по самому сообщению, а не по «режиму ожидания»:
  // человек не обязан оставлять номер и может продолжать спрашивать.
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 12 && /^[\d\s()+-]+$/.test(text)) {
    // Всегда берём последние 10 цифр: и 8XXX…, и 7XXX…, и без кода
    // приводятся к +7XXXXXXXXXX, который ждёт сервер.
    givenPhone = '+7' + digits.slice(-10);
    const t = addMsg('Отправляю…', 'bot typing');
    const res = await sendRequest({
      kind: 'consult',
      name: 'Из чата',
      phone: givenPhone,
      city: document.getElementById('cfCity') ? document.getElementById('cfCity').value : '',
      contact: 'call',
      project: 'заявка из чата',
      summary: chatSummary(),
      website: ''
    });
    t.remove();
    addMsg(res.ok
      ? 'Готово — менеджер свяжется с вами и ответит точно. Если удобнее в мессенджере — просто напишите, в каком.'
      : 'Не получилось отправить. Напишите номер ещё раз или нажмите «Получить консультацию» вверху страницы.', 'bot');
    if (res.ok) { phoneOffered = false; phoneGiven = true; }
    return;
  }

  // Номер уже оставили, а теперь просят связаться иначе — отправляем
  // отдельную уточняющую заявку на тот же номер, чтобы менеджер не позвонил зря.
  if (phoneGiven && givenPhone) {
    const want = CONTACT_SWITCH.find(c => c.re.test(text));
    const noCall = /не звон|не надо звонить|не нужно звонить|без звонк|не могу говорить|напиш/i.test(text);
    if (want || noCall) {
      const label = want ? want.value : 'telegram';
      const t = addMsg('Передаю менеджеру…', 'bot typing');
      const res = await sendRequest({
        kind: 'consult',
        name: 'Из чата',
        phone: givenPhone,
        city: document.getElementById('cfCity') ? document.getElementById('cfCity').value : '',
        contact: label,
        project: 'УТОЧНЕНИЕ к прошлой заявке — не звонить',
        summary: chatSummary(),
        website: ''
      });
      t.remove();
      addMsg(res.ok
        ? 'Передал: свяжемся в ' + (want ? want.name : 'мессенджере') + ' на этот же номер, звонить не будем.'
        : 'Не получилось передать. Напишите ещё раз, пожалуйста.', 'bot');
      return;
    }
  }

  chatHistory.push(text);
  const typing = addMsg('печатает…', 'bot typing');
  const res = await askAI(text);
  typing.remove();
  addMsg(изMarkdown(res.answer), 'bot');

  if (res.needsManager && !phoneOffered && !phoneGiven) {
    // Предлагаем оставить номер один раз, развёрнуто
    phoneOffered = true;
    sinceReminder = 0;
    setTimeout(() => addMsg('Оставьте номер телефона — менеджер посчитает и перезвонит. Или спрашивайте дальше, я на связи.', 'bot'), 420);
  } else if (phoneOffered && !phoneGiven) {
    // Дальше только короткое ненавязчивое напоминание и не каждый раз
    sinceReminder++;
    if (sinceReminder >= 2) {
      sinceReminder = 0;
      setTimeout(() => addMsg('Если нужен точный расчёт — оставьте номер, менеджер перезвонит.', 'bot hint'), 420);
    }
  }
}

// Модель иногда отвечает с markdown-разметкой, хотя в промпте это запрещено.
// Чат её не разбирает, и клиент видел в окне звёздочки и решётки. Полагаться
// только на промпт нельзя — подчищаем то, что всё-таки просочилось.
function изMarkdown(текст) {
  return String(текст || '')
    // Сначала гасим ЛЮБОЙ html, и только потом ставим свой.
    // Ответ модели попадает в innerHTML, а модель управляется текстом
    // посетителя: без экранирования он мог бы через промпт-инъекцию
    // добиться ответа вроде <img src=x onerror=...> и выполнить свой код.
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')     // **жирный**
    .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1<i>$2</i>')   // *курсив*
    .replace(/^#{1,6}\s*/gm, '')                // заголовки
    .replace(/^\s*[-–—]\s+/gm, '• ')            // маркеры списка
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Спрашиваем ИИ на сервере. Пока эндпоинт не настроен — отвечаем по
// заготовкам и честно передаём сложный вопрос менеджеру.
async function askAI(question) {
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, history: chatHistory.slice(-6) })
    });
    if (r.ok) {
      const d = await r.json();
      if (d.ok && d.answer) return { answer: d.answer, needsManager: !!d.needsManager };
    }
  } catch (e) { /* уходим в заготовки */ }

  const q = question.toLowerCase();
  const priceAsked = /цен|стои|сколько|рубл|бюджет/.test(q);
  let hit = null;
  if (priceAsked) hit = canned[1];
  else if (/достав|город|привез|москв|сарат|рязан|сборк/.test(q)) hit = canned[2];
  else if (/вход|комплект|состав|что будет|предмет/.test(q)) hit = canned[0];
  else if (/измен|подогн|размер|адапт|цвет|матери/.test(q)) hit = canned[3];

  if (hit) return { answer: hit.a, needsManager: priceAsked };
  return { answer: 'Это лучше уточнить у менеджера — он ответит точно.', needsManager: true };
}

// Забываем отказ через 7 дней, чтобы вернувшийся посетитель снова увидел предложение
const dismissedAt = Number(localStorage.getItem('consultantDismissed') || 0);
if (dismissedAt && Date.now() - dismissedAt > 7 * 24 * 60 * 60 * 1000) {
  localStorage.removeItem('consultantDismissed');
}

const consultantTimer = setInterval(() => {
  if (document.hidden) return;
  browsingSeconds++;
  if (browsingSeconds >= CONSULTANT_DELAY) { showBubble(); clearInterval(consultantTimer); }
}, 1000);

