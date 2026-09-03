// Габариты в метрах: ширина × глубина. Предметы без пола (зеркало, лампы,
// верхние шкафы) в плане не участвуют — они висят на стене.
const FOOTPRINT = {
  'Диван': [2.2, 0.9], 'Журнальный стол': [1.1, 0.6], 'ТВ-тумба': [1.6, 0.4],
  'Кресло': [0.85, 0.85], 'Второе кресло': [0.85, 0.85], 'Торшер': [0.4, 0.4],
  'Стеллаж': [1.2, 0.35], 'Обеденная группа': [1.6, 0.9],
  'Кровать': [1.6, 2.0], 'Прикроватные тумбы': [0.9, 0.4], 'Шкаф': [2.0, 0.6],
  'Комод': [1.2, 0.45], 'Пуф': [0.5, 0.5], 'Гардеробная система': [2.2, 0.6],
  'Кухонный гарнитур': [3.0, 0.6], 'Обеденный стол': [1.4, 0.8], 'Стулья': [1.2, 0.45],
  'Барная стойка': [1.6, 0.4], 'Кухонный остров': [1.6, 0.9], 'Буфет': [1.1, 0.45],
  'Мягкий уголок': [1.8, 0.7],
  'Письменный стол': [1.4, 0.7], 'Рабочее кресло': [0.7, 0.7], 'Тумба': [0.5, 0.5],
  'Книжный шкаф': [1.4, 0.4], 'Кресло для отдыха': [0.85, 0.85], 'Журнальный столик': [0.9, 0.5],
  'Шкаф для одежды': [1.6, 0.6], 'Вешалка': [0.6, 0.4], 'Полка для обуви': [0.9, 0.35],
  'Банкетка': [1.0, 0.4], 'Консольный столик': [0.9, 0.35], 'Встроенная гардеробная': [2.0, 0.6],
};
const RUG = { 'Ковёр': [2.4, 1.7] };

// Пересечение двух прямоугольников. Небольшой допуск, чтобы предметы
// могли стоять вплотную друг к другу, но не наезжать.
function planOverlap(a, b, gap = 0.02) {
  return !(a.x + a.w <= b.x + gap || a.x >= b.x + b.w - gap ||
           a.y + a.h <= b.y + gap || a.y >= b.y + b.h - gap);
}

// Ищем место для предмета: сначала вдоль стен (так расстановка выглядит
// жилой), потом любое свободное. Проверка на пересечения обязательна —
// без неё предметы у соседних стен сталкивались в углах.
function planFindSpot(W, H, placed, w0, d0) {
  const m = 0.05, step = 0.1;
  const fits = (b) => b.x >= m - 1e-9 && b.y >= m - 1e-9 &&
                      b.x + b.w <= W - m + 1e-9 && b.y + b.h <= H - m + 1e-9;
  const free = (b) => fits(b) && !placed.some(o => planOverlap(b, o));

  for (const [w, h] of [[w0, d0], [d0, w0]]) {
    if (w > W - 2 * m || h > H - 2 * m) continue;
    // вдоль нижней и верхней стен
    for (let x = m; x <= W - w - m + 1e-9; x += step) {
      for (const y of [H - h - m, m]) { const b = { x, y, w, h }; if (free(b)) return b; }
    }
    // вдоль левой и правой стен
    for (let y = m; y <= H - h - m + 1e-9; y += step) {
      for (const x of [m, W - w - m]) { const b = { x, y, w, h }; if (free(b)) return b; }
    }
  }
  // у стен места не осталось — ставим в любое свободное
  for (const [w, h] of [[w0, d0], [d0, w0]]) {
    if (w > W - 2 * m || h > H - 2 * m) continue;
    for (let y = m; y <= H - h - m + 1e-9; y += step)
      for (let x = m; x <= W - w - m + 1e-9; x += step) {
        const b = { x, y, w, h }; if (free(b)) return b;
      }
  }
  return null;
}

function packRoom(W, H, items) {
  const placed = [];
  // Крупное расставляем первым: мелочи потом легко находят себе место
  const list = items
    .filter(n => FOOTPRINT[n])
    .map(n => ({ n, w: Math.min(FOOTPRINT[n][0], W - 0.1), d: Math.min(FOOTPRINT[n][1], H - 0.1) }))
    .sort((a, b) => b.w * b.d - a.w * a.d);

  for (const it of list) {
    const spot = planFindSpot(W, H, placed, it.w, it.d);
    if (spot) placed.push({ ...spot, name: it.n });
  }
  return placed;
}

// ── Планировщик: комната пустая, мебель расставляет клиент ──
const planStage = document.getElementById('planStage');
let planRoom = null;      // { W, H } в метрах
let planBlocks = [];      // { name, x, y, w, h, rot }
let planDrag = null;
let planLastTap = 0;
let planLastIndex = -1;

const PLAN_PAD = 0.35;    // поле вокруг комнаты под размерные подписи

function planSizeOf(name) {
  const fp = FOOTPRINT[name] || RUG[name];
  if (!fp) return null;
  return [Math.min(fp[0], planRoom.W - 0.1), Math.min(fp[1], planRoom.H - 0.1)];
}

function drawPlan() {
  const { W, H } = planRoom, pad = PLAN_PAD;
  const vbW = W + pad * 2, vbH = H + pad * 2;
  const blocks = planBlocks.map((b, i) => {
    const isRug = !!RUG[b.name];
    return `<g class="plan-block" data-i="${i}">
      <rect x="${b.x + pad}" y="${b.y + pad}" width="${b.w}" height="${b.h}" rx="0.07"
            fill="#C4956A" fill-opacity="${isRug ? 0.22 : 0.6}"
            stroke="#2C2C2C" stroke-opacity="0.5" stroke-width="0.035"/>
      <title>${b.name}</title>
    </g>`;
  }).join('');

  planStage.innerHTML = `<svg viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${pad}" y="${pad}" width="${W}" height="${H}" rx="0.06"
          fill="#FDF8F0" stroke="#2C2C2C" stroke-opacity="0.5" stroke-width="0.07"/>
    ${blocks}
    <text x="${pad + W / 2}" y="${pad * 0.72}" font-size="0.26" text-anchor="middle" fill="#5C554C" font-family="Inter, sans-serif">${W.toFixed(1)} м</text>
    <text x="${pad * 0.62}" y="${pad + H / 2}" font-size="0.26" text-anchor="middle" fill="#5C554C" font-family="Inter, sans-serif" transform="rotate(-90 ${pad * 0.62} ${pad + H / 2})">${H.toFixed(1)} м</text>
  </svg>`;

  document.getElementById('planChips').innerHTML = plannerSet.items
    .filter(n => FOOTPRINT[n] || RUG[n])
    .map(n => {
      const placed = planBlocks.some(b => b.name === n);
      return `<button type="button" class="plan-chip${placed ? ' placed' : ''}" onclick="planAdd('${n}')">${n}</button>`;
    }).join('');
}

// Переводим координаты указателя в метры внутри комнаты
function planPointToMeters(e) {
  const svg = planStage.querySelector('svg');
  const r = svg.getBoundingClientRect();
  const vbW = planRoom.W + PLAN_PAD * 2;
  const scale = vbW / r.width;
  return {
    x: (e.clientX - r.left) * scale - PLAN_PAD,
    y: (e.clientY - r.top) * scale - PLAN_PAD,
  };
}

function planClampBlock(b) {
  b.x = Math.min(Math.max(b.x, 0.03), planRoom.W - b.w - 0.03);
  b.y = Math.min(Math.max(b.y, 0.03), planRoom.H - b.h - 0.03);
}

function planRotate(i) {
  const b = planBlocks[i];
  const nw = b.h, nh = b.w;
  if (nw > planRoom.W - 0.06 || nh > planRoom.H - 0.06) return;  // повёрнутым не влезет
  b.w = nw; b.h = nh;
  planClampBlock(b);
  drawPlan();
}

function planAdd(name) {
  if (planBlocks.some(b => b.name === name)) return;   // уже стоит
  const size = planSizeOf(name);
  if (!size) return;
  // Ковёр лежит под мебелью, поэтому пересечения для него не считаем
  const isRug = !!RUG[name];
  const others = isRug ? [] : planBlocks.filter(b => !RUG[b.name]);
  const spot = planFindSpot(planRoom.W, planRoom.H, others, size[0], size[1]);
  if (!spot) return;                                   // свободного места нет
  planBlocks.push({ ...spot, name });
  drawPlan();
}

function planAuto() {
  // Тот же алгоритм расстановки по периметру, что и раньше
  planBlocks = packRoom(planRoom.W, planRoom.H, plannerSet.items)
    .map(b => ({ name: b.name, x: b.x, y: b.y, w: b.w, h: b.h }));
  const rug = plannerSet.items.find(i => RUG[i]);
  if (rug) {
    const [rw, rh] = RUG[rug];
    const w = Math.min(rw, planRoom.W * 0.62), h = Math.min(rh, planRoom.H * 0.62);
    planBlocks.unshift({ name: rug, w, h, x: (planRoom.W - w) / 2, y: (planRoom.H - h) / 2 });
  }
  drawPlan();
}

function planClear() { planBlocks = []; drawPlan(); }

planStage.addEventListener('pointerdown', e => {
  const g = e.target.closest('.plan-block');
  if (!g) return;
  const i = +g.dataset.i;
  const p = planPointToMeters(e);
  // Двойное касание по одному предмету — поворот на 90°.
  // Раньше проверка опиралась на planDrag, но он обнуляется на pointerup,
  // и ко второму касанию условие уже не выполнялось — поворот не работал.
  const now = Date.now();
  if (now - planLastTap < 400 && planLastIndex === i) {
    planRotate(i);
    planLastTap = 0; planLastIndex = -1; planDrag = null;
    return;
  }
  planLastTap = now; planLastIndex = i;
  planDrag = { i, dx: p.x - planBlocks[i].x, dy: p.y - planBlocks[i].y };
  g.classList.add('dragging');
  planStage.setPointerCapture(e.pointerId);
});

planStage.addEventListener('pointermove', e => {
  if (!planDrag) return;
  const p = planPointToMeters(e);
  const b = planBlocks[planDrag.i];
  b.x = p.x - planDrag.dx; b.y = p.y - planDrag.dy;
  planClampBlock(b);
  drawPlan();
});

planStage.addEventListener('pointerup', () => { planDrag = null; });
planStage.addEventListener('pointercancel', () => { planDrag = null; });

// План в PNG — его отправляем менеджеру вместе с заявкой
function planToPng() {
  return new Promise(resolve => {
    const svgEl = planStage.querySelector('svg');
    if (!svgEl || !planBlocks.length) return resolve(null);
    const svg = new XMLSerializer().serializeToString(svgEl);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 900; c.height = Math.round(900 * (planRoom.H + PLAN_PAD * 2) / (planRoom.W + PLAN_PAD * 2));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#F1E4D2'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

