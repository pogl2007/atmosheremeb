// Сравнение WebP и AVIF на наших же снимках.
//
// Мерим то, что реально влияет на сайт: вес обложки карточки 800×1000 —
// именно они дают основной вес страницы каталога (197 штук на странице).
//
// Качество у кодеков несопоставимо по номеру: AVIF q50 примерно равен
// WebP q80. Поэтому гоняем несколько уровней и смотрим, где AVIF даёт
// тот же вес, а где — тот же вид.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'data', 'photos-src');
const ВЫБОРКА = 12;

// Тот же грейд, что в боевом пайплайне: сравниваем сопоставимое
const WARM_MUL = [1.045, 1.005, 0.945];
const WARM_OFF = [3, 1, -2];
const warm = img => img.toColourspace('srgb')
  .linear(WARM_MUL, WARM_OFF).modulate({ saturation: 1.04 });

(async () => {
  const все = fs.readdirSync(SRC).filter(f => /\.(jpe?g|png)$/i.test(f));
  // Берём равномерно по всему списку, а не первые попавшиеся:
  //源 разные, и светлые кухни жмутся не так, как тёмные гардеробные
  const шаг = Math.floor(все.length / ВЫБОРКА);
  const выборка = Array.from({ length: ВЫБОРКА }, (_, i) => все[i * шаг]).filter(Boolean);

  const варианты = [
    ['webp q80  (сейчас)', img => img.webp({ quality: 80 })],
    ['avif q50', img => img.avif({ quality: 50 })],
    ['avif q45', img => img.avif({ quality: 45 })],
    ['avif q40', img => img.avif({ quality: 40 })],
    ['avif q35', img => img.avif({ quality: 35 })],
  ];

  const итог = {};
  for (const [имя] of варианты) итог[имя] = { байт: 0, мс: 0 };

  for (const файл of выборка) {
    const п = path.join(SRC, файл);
    for (const [имя, кодек] of варианты) {
      const t0 = Date.now();
      const buf = await кодек(
        warm(sharp(п).rotate()).resize(800, 1000, { fit: 'cover', position: 'attention' })
      ).toBuffer();
      итог[имя].байт += buf.length;
      итог[имя].мс += Date.now() - t0;
    }
  }

  const база = итог['webp q80  (сейчас)'].байт;
  const базаМс = итог['webp q80  (сейчас)'].мс;

  console.log(`Выборка: ${выборка.length} снимков, размер обложки 800×1000\n`);
  console.log('вариант'.padEnd(20), 'средний вес'.padStart(12), 'разница'.padStart(10), 'кодирование'.padStart(14));
  for (const [имя] of варианты) {
    const { байт, мс } = итог[имя];
    const средн = (байт / выборка.length / 1024).toFixed(1) + ' КБ';
    const разн = имя.startsWith('webp') ? '—' : (((байт / база) - 1) * 100).toFixed(0) + '%';
    const скор = (мс / выборка.length).toFixed(0) + ' мс/шт'
      + (имя.startsWith('webp') ? '' : ` (×${(мс / базаМс).toFixed(1)})`);
    console.log(имя.padEnd(20), средн.padStart(12), разн.padStart(10), скор.padStart(14));
  }

  // Пересчёт на весь каталог: 197 обложек + 197 файлов галереи
  const экономия = (база - итог['avif q45'].байт) / выборка.length * 394 / 1048576;
  console.log(`\nЕсли перевести все 394 файла каталога на avif q45:`);
  console.log(`  экономия примерно ${экономия.toFixed(1)} МБ из нынешних 24.2 МБ`);
})();
