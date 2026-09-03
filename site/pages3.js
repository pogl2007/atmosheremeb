// Страница планировщика.
//
// Раньше расстановка открывалась из карточки комплекта комнаты. После
// перехода на отдельные изделия это перестало иметь смысл, поэтому
// планировщик стал самостоятельным инструментом: выбираешь тип комнаты,
// задаёшь размеры и расставляешь мебель сам.

const { page, ВЕРСИИ } = require('./layout.js');

const КОМНАТЫ = [
  ['Кухня', 'M7 30h50v23H7zM7 39h50M32 30v23'],
  ['Гостиная', 'M10 34v-6a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v6M6 34h52v14H6z'],
  ['Спальня', 'M7 46V25h6v6M7 31h50v15H7z'],
  ['Детская', 'M12 44V20h40v24M12 32h40'],
  ['Кабинет', 'M5 28h34v4H5zM10 32v20M34 32v20M44 16h15v36H44z'],
  ['Прихожая', 'M8 9h27v45H8zM21.5 9v45'],
];

function планировщик(каталог) {
  const плитки = КОМНАТЫ.map(([имя, path]) => `
      <button type="button" class="room-pick" data-room="${имя}" onclick="плВыбрать('${имя}')">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>
        <span>${имя}</span>
      </button>`).join('');

  const body = `
<div class="container">
  <nav class="crumbs"><a href="/">Главная</a><span>/</span>Планировщик</nav>
  <div class="page-head">
    <h1>Планировщик комнаты</h1>
    <p>Задайте размеры помещения и расставьте мебель так, как хотите её видеть. Готовый план придёт нам вместе с заявкой — по нему сразу понятно, о чём речь.</p>
  </div>

  <div id="plannerPick">
    <h2 style="font-family:var(--font-d);font-size:26px;margin-bottom:16px;">Какую комнату планируем?</h2>
    <div class="room-picks">${плитки}</div>
  </div>

  <div id="plannerWork" hidden>
    <div class="planner-layout">
      <div>
        <div class="planner-size">
          <button class="btn btn-ghost btn-sm" type="button" onclick="плНазад()">← Другая комната</button>
          <label>Ширина, м <input id="plW" type="number" min="1.5" max="12" step="0.1" onchange="плРазмер()"></label>
          <label>Глубина, м <input id="plH" type="number" min="1.5" max="12" step="0.1" onchange="плРазмер()"></label>
        </div>

        <div class="plan-stage" id="planStage"></div>
        <div class="plan-hint">Перетащите мебель внутрь комнаты. Двойное касание по предмету — повернуть на 90°</div>
        <div class="plan-tools">
          <button type="button" onclick="planAuto()">Расставить за меня</button>
          <button type="button" onclick="planClear()">Очистить</button>
        </div>
        <div class="plan-palette">
          <div class="plan-palette-title">Мебель</div>
          <div class="plan-chips" id="planChips"></div>
        </div>
      </div>

      <form class="cart-form" onsubmit="плОтправить(event)">
        <h3>Прислать план нам</h3>
        <p class="hint">Отправим менеджеру картинку вашей расстановки вместе с размерами комнаты.</p>
        <div class="field">
          <label for="p-name">Как к вам обращаться</label>
          <input id="p-name" name="name" type="text" autocomplete="name" placeholder="Имя">
          <div class="err">Напишите имя</div>
        </div>
        <div class="field">
          <label for="p-phone">Телефон</label>
          <input id="p-phone" name="phone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00">
          <div class="err">Нужен номер из 10 цифр</div>
        </div>
        <div class="field">
          <label for="p-contact">Где удобнее общаться</label>
          <select id="p-contact" name="contact">
            <option value="call">Звонок</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="max">Max</option>
          </select>
        </div>
        <div class="hp" aria-hidden="true">
          <label>Не заполняйте это поле<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Отправить план</button>
        <p class="product-note">Нажимая кнопку, вы соглашаетесь на обработку персональных данных.</p>
      </form>
    </div>
  </div>
</div>
<div style="height:60px"></div>`;

  return page({
    title: 'Планировщик комнаты | Атмосфера Мебель',
    description: 'Задайте размеры комнаты и расставьте мебель онлайн. Готовый план отправим менеджеру вместе с заявкой.',
    canonical: '/planner/', active: 'planner', категории: каталог.categories, body,
    extraBody: `<script src="/assets/planner.js${ВЕРСИИ.planner ? "?v=" + ВЕРСИИ.planner : ""}"></script>`,
  });
}

module.exports = { планировщик };
