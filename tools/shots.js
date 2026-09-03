// Снимки страниц для разбора вёрстки. Не часть сборки сайта.
//   node tools/shots.js [адрес]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const БАЗА = process.argv[2] || 'http://localhost:8000';
const КУДА = path.join(__dirname, '..', 'shots');

const СТРАНИЦЫ = [
  ['home', '/'],
  ['catalog', '/catalog/'],
  ['product', '/product/dyuna/'],
  ['cart', '/cart/'],
  ['contacts', '/contacts/'],
  ['about', '/about/'],
  ['blog', '/blog/'],
];

const ЭКРАНЫ = [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
];

(async () => {
  fs.mkdirSync(КУДА, { recursive: true });
  const браузер = await chromium.launch();

  for (const [имяЭкрана, w, h] of ЭКРАНЫ) {
    const контекст = await браузер.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      isMobile: имяЭкрана === 'mobile',
      hasTouch: имяЭкрана === 'mobile',
    });
    const стр = await контекст.newPage();

    for (const [имя, путь] of СТРАНИЦЫ) {
      try {
        await стр.goto(БАЗА + путь, { waitUntil: 'networkidle', timeout: 30000 });
        // Домотать до низа и обратно: ленивые картинки и появления по скроллу
        await стр.evaluate(async () => {
          await new Promise(r => {
            let y = 0;
            const шаг = setInterval(() => {
              window.scrollBy(0, 600); y += 600;
              if (y >= document.body.scrollHeight) { clearInterval(шаг); window.scrollTo(0, 0); r(); }
            }, 60);
          });
        });
        await стр.waitForTimeout(700);
        const файл = path.join(КУДА, `${имя}-${имяЭкрана}.png`);
        await стр.screenshot({ path: файл, fullPage: true });
        const кб = (fs.statSync(файл).size / 1024).toFixed(0);
        console.log(`  ${имя}-${имяЭкрана}.png  ${кб} КБ`);
      } catch (e) {
        console.log(`  ${имя}-${имяЭкрана}  ОШИБКА: ${e.message.split('\n')[0]}`);
      }
    }
    await контекст.close();
  }

  await браузер.close();
  console.log('\nГотово: ' + КУДА);
})();
