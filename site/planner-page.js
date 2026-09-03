// Управление страницей планировщика: выбор комнаты, размеры, отправка плана.
//
// Ядро расстановки (planner-core) осталось прежним — оно проверено и
// расставляет без наложений. Изменилось только то, откуда берётся список
// предметов: раньше это был состав выбранного комплекта комнаты, теперь —
// палитра под выбранный тип помещения.

// plannerSet заполняется при выборе комнаты; ядро читает plannerSet.items
let plannerSet = { items: [] };

const ПАЛИТРЫ = {
  'Кухня': ['Кухонный гарнитур', 'Обеденный стол', 'Стулья', 'Кухонный остров',
            'Барная стойка', 'Буфет', 'Холодильник'],
  'Гостиная': ['Диван', 'Кресло', 'Второе кресло', 'Журнальный стол', 'ТВ-тумба',
               'Стеллаж', 'Торшер', 'Обеденная группа', 'Ковёр'],
  'Спальня': ['Кровать', 'Прикроватные тумбы', 'Шкаф', 'Комод', 'Пуф',
              'Гардеробная система', 'Ковёр'],
  'Детская': ['Кровать', 'Письменный стол', 'Рабочее кресло', 'Шкаф для одежды',
              'Стеллаж', 'Комод', 'Ковёр'],
  'Кабинет': ['Письменный стол', 'Рабочее кресло', 'Стеллаж', 'Книжный шкаф',
              'Тумба', 'Кресло для отдыха', 'Диван'],
  'Прихожая': ['Шкаф для одежды', 'Вешалка', 'Полка для обуви', 'Банкетка',
               'Комод', 'Консольный столик', 'Встроенная гардеробная'],
};

// Холодильник в исходной таблице габаритов отсутствовал
FOOTPRINT['Холодильник'] = [0.6, 0.65];

const плНачальные = { 'Кухня': [3.2, 2.6], 'Гостиная': [5.0, 4.0], 'Спальня': [4.0, 3.4],
                      'Детская': [3.6, 3.2], 'Кабинет': [3.4, 3.0], 'Прихожая': [2.6, 1.8] };

let плКомната = null;

function плВыбрать(тип) {
  плКомната = тип;
  plannerSet = { items: ПАЛИТРЫ[тип] };
  const [W, H] = плНачальные[тип];
  document.getElementById('plW').value = W;
  document.getElementById('plH').value = H;
  planRoom = { W, H };
  planBlocks = [];

  document.querySelectorAll('[data-room]').forEach(b =>
    b.classList.toggle('on', b.dataset.room === тип));
  document.getElementById('plannerWork').hidden = false;
  document.getElementById('plannerPick').hidden = true;
  drawPlan();
}

function плРазмер() {
  const W = Math.min(Math.max(parseFloat(document.getElementById('plW').value) || 3, 1.5), 12);
  const H = Math.min(Math.max(parseFloat(document.getElementById('plH').value) || 3, 1.5), 12);
  planRoom = { W, H };
  // Всё, что оказалось за новыми стенами, возвращаем внутрь
  planBlocks.forEach(b => {
    b.w = Math.min(b.w, W - 0.1);
    b.h = Math.min(b.h, H - 0.1);
    planClampBlock(b);
  });
  drawPlan();
}

function плНазад() {
  document.getElementById('plannerWork').hidden = true;
  document.getElementById('plannerPick').hidden = false;
  planBlocks = [];
}

async function плОтправить(e) {
  e.preventDefault();
  const form = e.target;
  const nameF = form.querySelector('[name=name]').closest('.field');
  const phoneF = form.querySelector('[name=phone]').closest('.field');
  const name = form.name.value.trim();
  const phone = normalizePhone(form.phone.value);

  nameF.classList.toggle('bad', name.length < 2);
  phoneF.classList.toggle('bad', !phone);
  if (name.length < 2 || !phone) return;

  if (!planBlocks.length) { toast('Сначала расставьте мебель'); return; }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Отправляем…';

  const png = await planToPng();
  const состав = planBlocks.map(b => b.name).join(', ');

  let ok = false;
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, phone,
        contact: form.contact.value,
        website: form.website.value,
        room: плКомната,
        size: `${planRoom.W.toFixed(1)} × ${planRoom.H.toFixed(1)} м`,
        items: состав,
        image: png,
      }),
    });
    ok = (await res.json()).ok;
  } catch { ok = false; }

  if (ok) {
    form.innerHTML = '<h3>План отправлен</h3><p class="hint">Мы получили вашу расстановку и свяжемся, чтобы обсудить детали.</p>';
  } else {
    btn.disabled = false;
    btn.textContent = 'Отправить план';
    toast('Не удалось отправить. Попробуйте ещё раз.');
  }
}
