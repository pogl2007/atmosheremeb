<?php
// Принимает заявки с сайта и пересылает их в Telegram.
// Токен и chat_id живут только здесь, на сервере — фронтенду они не видны.

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

// ── простой файловый rate-limit: 5 заявок в минуту с одного IP ──
function isRateLimited($ip) {
    $dir = sys_get_temp_dir() . '/atmosphere_ratelimit';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $file = $dir . '/' . md5($ip) . '.json';
    $now = time();
    $windowSeconds = 60;
    $max = 5;

    $fp = fopen($file, 'c+');
    if (!$fp) return false; // не блокируем, если не смогли открыть файл
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $hits = $raw ? json_decode($raw, true) : [];
    if (!is_array($hits)) $hits = [];
    $hits = array_values(array_filter($hits, fn($t) => $now - $t < $windowSeconds));
    $hits[] = $now;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($hits));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    return count($hits) > $max;
}

function clean($value, $maxLen) {
    $value = preg_replace('/[\r\n\t]+/', ' ', (string) $value);
    $value = trim($value);
    return mb_substr($value, 0, $maxLen);
}

$CONTACT_LABELS = ['call' => 'Позвонить', 'whatsapp' => 'WhatsApp', 'telegram' => 'Telegram', 'max' => 'Max'];

function buildConsultMessage($body) {
    global $CONTACT_LABELS;

    $name = clean($body['name'] ?? '', 100);
    $phone = clean($body['phone'] ?? '', 30);
    if (!$name || !preg_match('/^\+7\d{10}$/', $phone)) return null;

    $city = in_array($body['city'] ?? '', ['Москва', 'Саратов', 'Рязань'], true)
        ? $body['city']
        : (clean($body['city'] ?? '', 50) ?: '—');
    $contact = $CONTACT_LABELS[$body['contact'] ?? ''] ?? 'Не указано';
    $project = clean($body['project'] ?? '', 80);
    $summary = clean($body['summary'] ?? '', 400);

    $msg = "Новая заявка с сайта\n" .
        "Имя: {$name}\n" .
        "Телефон: {$phone}\n" .
        "Город: {$city}\n" .
        "Связь: {$contact}";
    if ($project) $msg .= "\nИсточник: {$project}";
    if ($summary) $msg .= "\n\nО клиенте (о чём спрашивал в чате):\n{$summary}";
    return $msg;
}

// Заявка из корзины. Отдельный сборщик, потому что список позиций
// не помещается в поле «источник» обычной консультации.
function buildOrderMessage($body) {
    global $CONTACT_LABELS;

    $name = clean($body['name'] ?? '', 100);
    $phone = clean($body['phone'] ?? '', 30);
    if (!$name || !preg_match('/^\+7\d{10}$/', $phone)) return null;

    $contact = $CONTACT_LABELS[$body['contact'] ?? ''] ?? 'Не указано';
    $позиции = array_values(array_filter(array_map('trim',
        explode(';', clean($body['project'] ?? '', 1500)))));

    $msg = "ЗАЯВКА ИЗ КОРЗИНЫ\n" .
        "Имя: {$name}\n" .
        "Телефон: {$phone}\n" .
        "Связь: {$contact}\n\n" .
        'Позиций: ' . count($позиции);
    foreach ($позиции as $i => $p) $msg .= "\n" . ($i + 1) . ". {$p}";

    $summary = clean($body['summary'] ?? '', 400);
    if ($summary) $msg .= "\n\n{$summary}";
    return $msg;
}

// Журнал заявок — его читает админка. Формат JSON Lines: одна заявка =
// одна дописанная строка. При дописывании с LOCK_EX две одновременные
// заявки не портят файл, как испортила бы перезапись целого массива.
function сохранитьЗаявку($запись) {
    $файл = __DIR__ . '/../data/orders.log.php';
    // Первая строка обрывает выполнение: по прямой ссылке файл не скачать
    $заглушка = '<?php http_response_code(404); exit; ?>' . "\n";
    $папка = dirname($файл);
    if (!is_dir($папка)) @mkdir($папка, 0755, true);
    if (!is_file($файл)) @file_put_contents($файл, $заглушка);
    $запись = array_merge(['at' => gmdate('c')], $запись);
    // Журнал вторичен: заявка уже ушла в Telegram, ронять ответ из-за
    // проблем с диском нельзя, поэтому ошибки подавляются намеренно.
    @file_put_contents($файл,
        json_encode($запись, JSON_UNESCAPED_UNICODE) . "\n",
        FILE_APPEND | LOCK_EX);
}

function buildCityMessage($body) {
    $email = clean($body['email'] ?? '', 200);
    if (!$email || strpos($email, '@') === false) return null;
    return "Запрос на новый город\nEmail: {$email}";
}

function sendToTelegram($text) {
    $url = 'https://api.telegram.org/bot' . TELEGRAM_BOT_TOKEN . '/sendMessage';
    $payload = json_encode(['chat_id' => TELEGRAM_CHAT_ID, 'text' => $text], JSON_UNESCAPED_UNICODE);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        $result = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($result === false) return ['ok' => false, 'error' => $err];
        $data = json_decode($result, true);
        return $data ?: ['ok' => false, 'error' => 'Bad response'];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $payload,
            'timeout' => 10,
        ],
    ]);
    $result = @file_get_contents($url, false, $context);
    if ($result === false) return ['ok' => false, 'error' => 'Request failed'];
    $data = json_decode($result, true);
    return $data ?: ['ok' => false, 'error' => 'Bad response'];
}

$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (isRateLimited($ip)) {
    respond(429, ['ok' => false, 'error' => 'Слишком много заявок. Попробуйте через минуту.']);
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) $body = [];

// Honeypot: скрытое поле, которое видят и заполняют только боты.
if (!empty($body['website'])) {
    respond(200, ['ok' => true]);
}

$kind = $body['kind'] ?? '';
if ($kind === 'consult') {
    $text = buildConsultMessage($body);
} elseif ($kind === 'order') {
    $text = buildOrderMessage($body);
} elseif ($kind === 'city') {
    $text = buildCityMessage($body);
} else {
    respond(400, ['ok' => false, 'error' => 'Неизвестный тип заявки']);
}

if (!$text) {
    respond(400, ['ok' => false, 'error' => 'Проверьте правильность заполнения полей']);
}

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    error_log('Заявка не отправлена — нет учётных данных Telegram: ' . $text);
    respond(500, ['ok' => false, 'error' => 'Сервис временно недоступен']);
}

$tg = sendToTelegram($text);
if (empty($tg['ok'])) {
    error_log('Telegram send failed: ' . json_encode($tg));
    respond(502, ['ok' => false, 'error' => 'Не удалось отправить заявку, попробуйте позже']);
}

сохранитьЗаявку([
    'kind'    => $kind,
    'name'    => clean($body['name'] ?? '', 100),
    'phone'   => clean($body['phone'] ?? '', 30),
    'contact' => clean($body['contact'] ?? '', 20),
    'text'    => $text,
]);

respond(200, ['ok' => true]);
