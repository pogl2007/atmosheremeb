/* ═══════════ Слайдер в шапке главной ═══════════
   Показывает по одному товару из разных разделов и сам листает.
   Останавливается под курсором, при уходе со вкладки и если человек
   выключил анимации в системе. */

function initHeroSlider() {
  const блок = document.getElementById('heroShot');
  if (!блок) return;

  const слайды = [...блок.querySelectorAll('.hero-slide')];
  const точки = [...блок.querySelectorAll('.hero-dot')];
  if (слайды.length < 2) return;

  const ПАУЗА = 5000;
  let текущий = 0;
  let таймер = null;

  function показать(i) {
    текущий = (i + слайды.length) % слайды.length;
    слайды.forEach((s, n) => {
      const активен = n === текущий;
      s.classList.toggle('on', активен);
      // Спрятанный слайд не должен ловить фокус табом и читаться скринридером
      s.toggleAttribute('aria-hidden', !активен);
      if (активен) s.removeAttribute('tabindex');
      else s.setAttribute('tabindex', '-1');
    });
    точки.forEach((t, n) => {
      t.classList.toggle('on', n === текущий);
      t.setAttribute('aria-selected', String(n === текущий));
    });
  }

  function пуск() {
    стоп();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    таймер = setInterval(() => показать(текущий + 1), ПАУЗА);
  }
  function стоп() { clearInterval(таймер); таймер = null; }

  точки.forEach(t => t.addEventListener('click', () => {
    показать(Number(t.dataset.slide));
    пуск();   // после ручного выбора отсчёт начинаем заново
  }));

  блок.addEventListener('mouseenter', стоп);
  блок.addEventListener('mouseleave', пуск);
  блок.addEventListener('focusin', стоп);
  блок.addEventListener('focusout', пуск);

  // На скрытой вкладке крутить бессмысленно: браузер всё равно душит таймеры,
  // а по возвращении слайды успевают проскочить пачкой.
  document.addEventListener('visibilitychange', () => {
    document.hidden ? стоп() : пуск();
  });

  показать(0);
  пуск();
}
