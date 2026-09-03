const ba = document.getElementById('ba');
const baGrip = document.getElementById('baGrip');
let baDragging = false;

function setBa(percent) {
  const p = Math.min(Math.max(percent, 0), 100);
  ba.style.setProperty('--pos', p + '%');
  baGrip.setAttribute('aria-valuenow', Math.round(p));
}

function baFromEvent(e) {
  const r = ba.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  setBa(x / r.width * 100);
}

if (ba) {
  // Тянуть можно и за ручку, и просто нажав в любом месте картинки
  ba.addEventListener('pointerdown', e => {
    baDragging = true;
    ba.setPointerCapture(e.pointerId);
    baFromEvent(e);
  });
  ba.addEventListener('pointermove', e => { if (baDragging) baFromEvent(e); });
  ba.addEventListener('pointerup', e => { baDragging = false; ba.releasePointerCapture(e.pointerId); });
  ba.addEventListener('pointercancel', () => { baDragging = false; });

  // Стрелками с клавиатуры — чтобы слайдер работал без мыши
  baGrip.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 4;
    const now = parseFloat(ba.style.getPropertyValue('--pos')) || 50;
    if (e.key === 'ArrowLeft') { setBa(now - step); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setBa(now + step); e.preventDefault(); }
  });

  // Один раз показываем, что ручку можно двигать.
  // Анимируем покадрово через requestAnimationFrame: раньше это была череда
  // мгновенных скачков по таймеру, и ручка дёргалась.
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function baTween(from, to, ms) {
    return new Promise(resolve => {
      const t0 = performance.now();
      (function frame(now) {
        if (baDragging) return resolve();          // человек взялся сам — не мешаем
        const t = Math.min((now - t0) / ms, 1);
        setBa(from + (to - from) * easeInOut(t));
        if (t < 1) requestAnimationFrame(frame); else resolve();
      })(t0);
    });
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    let teased = false;
    new IntersectionObserver(async entries => {
      if (!entries[0].isIntersecting || teased) return;
      teased = true;
      await new Promise(r => setTimeout(r, 700));
      await baTween(50, 84, 1100);
      await baTween(84, 22, 1500);
      await baTween(22, 50, 1100);
    }, { threshold: 0.4 }).observe(ba);
  }
}

