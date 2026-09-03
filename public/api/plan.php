<?php
// План комнаты приходит PNG-картинкой в base64 и уходит в Telegram
// отдельным сообщением следом за заявкой.

require __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

function respond($code, $data) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
}
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    respond(200, ['ok' => false]);
}

// ── лимит: 5 планов в минуту с одного IP ──
$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$dir = sys_get_temp_dir() . '/atmosphere_planlimit';
if (!is_dir($dir)) mkdir($dir, 0700, true);
$file = $dir . '/' . md5($ip) . '.json';
$now = time();
$fp = fopen($file, 'c+');
if ($fp) {
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $hits = $raw ? json_decode($raw, true) : [];
    if (!is_array($hits)) $hits = [];
    $hits = array_values(array_filter($hits, fn($t) => $now - $t < 60));
    $hits[] = $now;
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($hits));
    fflush($fp); flock($fp, LOCK_UN); fclose($fp);
    if (count($hits) > 5) respond(200, ['ok' => false]);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];

if (!empty($body['website'])) respond(200, ['ok' => true]);   // ловушка для ботов

function планСтрока($v, $len) {
    return mb_substr(trim(preg_replace('/[\r\n\t]+/', ' ', (string) $v)), 0, $len);
}

$name = планСтрока($body['name'] ?? '', 100);
$phone = планСтрока($body['phone'] ?? '', 30);
if (!$name || !preg_match('/^\+7\d{10}$/', $phone)) {
    respond(400, ['ok' => false, 'error' => 'Проверьте имя и телефон']);
}

$image = (string) ($body['image'] ?? '');
if (!preg_match('~^data:image/png;base64,([A-Za-z0-9+/=]+)$~', $image, $m)) {
    respond(400, ['ok' => false, 'error' => 'Ожидается PNG в base64']);
}
$binary = base64_decode($m[1], true);
if ($binary === false || strlen($binary) > 3000000) {
    respond(413, ['ok' => false, 'error' => 'Слишком большой файл']);
}

// Подпись к снимку — это и есть заявка: в Telegram она видна прямо
// под картинкой, отдельным сообщением дублировать не нужно.
$CONTACT_LABELS = ['call' => 'Позвонить', 'whatsapp' => 'WhatsApp', 'telegram' => 'Telegram', 'max' => 'Max'];
$caption = mb_substr(implode("\n", [
    'ПЛАН КОМНАТЫ С САЙТА',
    "Имя: {$name}",
    "Телефон: {$phone}",
    'Связь: ' . ($CONTACT_LABELS[$body['contact'] ?? ''] ?? 'Не указано'),
    'Комната: ' . (планСтрока($body['room'] ?? '', 40) ?: '—'),
    'Размеры: ' . (планСтрока($body['size'] ?? '', 40) ?: '—'),
    'Мебель: ' . (планСтрока($body['items'] ?? '', 400) ?: '—'),
]), 0, 1024);   // ограничение Telegram на подпись к фото

$tmp = tempnam(sys_get_temp_dir(), 'plan');
file_put_contents($tmp, $binary);

$ch = curl_init('https://api.telegram.org/bot' . TELEGRAM_BOT_TOKEN . '/sendPhoto');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    // Без JSON: sendPhoto принимает файл только через multipart/form-data
    CURLOPT_POSTFIELDS => [
        'chat_id' => TELEGRAM_CHAT_ID,
        'caption' => $caption,
        'photo' => new CURLFile($tmp, 'image/png', 'plan.png'),
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 25,
]);
$raw = curl_exec($ch);
$err = curl_error($ch);
curl_close($ch);
@unlink($tmp);

if ($raw === false) {
    error_log('Plan send failed: ' . $err);
    respond(200, ['ok' => false]);
}
$data = json_decode($raw, true);
respond(200, ['ok' => !empty($data['ok'])]);
