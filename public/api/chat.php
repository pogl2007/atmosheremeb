<?php
// ИИ-консультант. Ключ и адрес живут только здесь, на сервере.
// Настройки берутся из config.php: AI_API_URL, AI_API_KEY, AI_MODEL.
// Если они пустые — отдаём ok:false с кодом 200: для сайта это штатный откат
// на заготовленные ответы, а не сбой, и консоль браузера остаётся чистой.

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

if (!defined('AI_API_URL') || !AI_API_URL || !defined('AI_API_KEY') || !AI_API_KEY) {
    respond(200, ['ok' => false, 'error' => 'AI не настроен']);
}

// ── лимит: 15 сообщений в минуту с одного IP ──
function chatRateLimited($ip) {
    $dir = sys_get_temp_dir() . '/atmosphere_chatlimit';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $file = $dir . '/' . md5($ip) . '.json';
    $now = time();
    $fp = fopen($file, 'c+');
    if (!$fp) return false;
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $hits = $raw ? json_decode($raw, true) : [];
    if (!is_array($hits)) $hits = [];
    $hits = array_values(array_filter($hits, fn($t) => $now - $t < 60));
    $hits[] = $now;
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($hits));
    fflush($fp); flock($fp, LOCK_UN); fclose($fp);
    return count($hits) > 15;
}

function clean_text($v, $max) {
    $v = preg_replace('/[\r\n\t]+/', ' ', (string) $v);
    return mb_substr(trim($v), 0, $max);
}

$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (chatRateLimited($ip)) {
    respond(200, ['ok' => false, 'error' => 'Слишком много сообщений, подождите минуту.']);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];
$message = clean_text($body['message'] ?? '', 500);
if (!$message) respond(400, ['ok' => false, 'error' => 'Пустой вопрос']);

$history = [];
if (!empty($body['history']) && is_array($body['history'])) {
    foreach (array_slice($body['history'], -6) as $h) {
        $t = clean_text($h, 500);
        if ($t) $history[] = ['role' => 'user', 'content' => $t];
    }
}

// Жёсткие рамки: бот не должен выдумывать цены, сроки и условия.
// Промпт лежит отдельным файлом, собранным из site/facts.js. Тот же файл
// читает и локальный Node-сервер — так факты о компании гарантированно
// совпадают с текстами сайта и не разъезжаются при смене условий работы.
$файлПромпта = __DIR__ . '/../data/ai-prompt.txt';
$system = is_file($файлПромпта) ? (string) file_get_contents($файлПромпта) : '';

if (trim($system) === "") {
    error_log('Нет файла ai-prompt.txt — соберите сайт: node tools/build-site.js');
    respond(200, ['ok' => false, 'error' => 'AI не настроен']);
}

// Провайдер Nodule работает по OpenAI Responses API: системный промпт идёт
// полем instructions, сообщения — в input, лимит зовётся max_output_tokens.
$payload = json_encode([
    'model' => defined('AI_MODEL') ? AI_MODEL : '',
    'instructions' => $system,
    'input' => array_merge($history, [['role' => 'user', 'content' => $message]]),
    // Запас с избытком: часть лимита съедают невидимые reasoning-токены.
    'max_output_tokens' => 700,
    'reasoning' => ['effort' => 'low'],
    'store' => false,
], JSON_UNESCAPED_UNICODE);

$ch = curl_init(AI_API_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . AI_API_KEY],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 25,
]);
$raw = curl_exec($ch);
$err = curl_error($ch);
curl_close($ch);

if ($raw === false) {
    error_log('AI chat failed: ' . $err);
    respond(200, ['ok' => false, 'error' => 'AI недоступен']);
}

// В ответе нет output_text: первым в output идёт элемент reasoning,
// поэтому текст ищем в элементе с типом message.
$data = json_decode($raw, true);
$answer = '';
foreach (($data['output'] ?? []) as $item) {
    if (($item['type'] ?? '') !== 'message') continue;
    foreach (($item['content'] ?? []) as $part) {
        if (!empty($part['text'])) $answer .= ($answer ? ' ' : '') . $part['text'];
    }
}
$answer = trim($answer);
if (!$answer) {
    error_log('AI chat empty response: ' . mb_substr($raw, 0, 300));
    respond(200, ['ok' => false, 'error' => 'AI недоступен']);
}

$needsManager = mb_strpos($answer, '[MANAGER]') !== false;
$answer = trim(str_replace('[MANAGER]', '', $answer));

respond(200, ['ok' => true, 'answer' => $answer, 'needsManager' => $needsManager]);
