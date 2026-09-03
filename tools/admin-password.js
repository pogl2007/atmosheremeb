// Смена пароля от админки: node tools/admin-password.js "новый пароль"
//
// Выводит три строки для config.php. Сам пароль никуда не записывается —
// его нужно запомнить или положить в менеджер паролей.
//
// PBKDF2-SHA256, а не bcrypt: одинаково считается и в Node, и в PHP
// (hash_pbkdf2), поэтому хеш можно сгенерировать здесь, а проверять там,
// не таща в проект зависимостей.

const crypto = require('crypto');

const пароль = process.argv.slice(2).join(' ').trim();

if (!пароль) {
  console.error('Укажите пароль:  node tools/admin-password.js "мой новый пароль"');
  process.exit(1);
}
if (пароль.length < 8) {
  console.error('Слишком короткий пароль — нужно хотя бы 8 символов.');
  process.exit(1);
}

const соль = crypto.randomBytes(16).toString('hex');
const итераций = 200000;
const хеш = crypto.pbkdf2Sync(пароль, соль, итераций, 32, 'sha256').toString('hex');

console.log('Замените эти три строки в public/config.php:\n');
console.log(`define('ADMIN_SALT', '${соль}');`);
console.log(`define('ADMIN_ITER', ${итераций});`);
console.log(`define('ADMIN_HASH', '${хеш}');`);
console.log('\nПароль нигде не сохранён — запомните его.');
