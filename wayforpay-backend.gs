/**
 * ============================================================
 * Бекенд на Google Apps Script: WayForPay webhook + перевірка логіна
 * ============================================================
 *
 * ЩО РОБИТЬ:
 * 1. Приймає вебхук від WayForPay після оплати (serviceUrl).
 * 2. Перевіряє підпис (щоб ніхто не підробив запит).
 * 3. Генерує унікальний код доступу, зберігає в Google Таблицю,
 *    надсилає клієнту лист з кодом.
 * 4. Приймає запити від cabinet.js на перевірку "email + код".
 *
 * ============================================================
 * НАЛАШТУВАННЯ ПЕРЕД ЗАПУСКОМ:
 * ============================================================
 * 1. Відкрий https://script.google.com → "Новий проєкт".
 * 2. Встав цей код замість дефолтного.
 * 3. Заповни 3 змінні нижче (MERCHANT_SECRET_KEY, SHEET_ID, FROM_NAME).
 * 4. "Розгорнути" → "Нове розгортання" → тип "Веб-застосунок":
 *      - Виконати від імені: "Я"
 *      - Хто має доступ: "Будь-хто"
 *    Скопіюй URL, який дасть Google (закінчується на /exec).
 * 5. Встав цей URL:
 *      а) У WayForPay: Кабінет мерчанта → Налаштування магазину → Service URL
 *      б) У cabinet.js: у змінну API_URL (див. інструкцію нижче)
 * 6. Створи Google Таблицю, назви перший лист "Покупці" з заголовками
 *    в рядку 1: Email | OrderReference | Код | Дата | Сума | Статус | Ім'я
 *    (колонку "Статус" залиш порожньою — заповнюй "заблоковано", якщо
 *    треба відкликати доступ конкретному покупцю без видалення рядка.
 *    Колонка "Ім'я" заповнюється автоматично, коли учень вводить своє ім'я в кабінеті.)
 *    Скопіюй ID таблиці з URL (docs.google.com/spreadsheets/d/ЦЕЙ_ID/edit)
 *    Другий лист "Прогрес" створювати не треба — з'явиться сам при
 *    першому збереженні прогресу (Email | Дані (JSON) | Оновлено).
 *
 * ЗАХИСТ ВІД ПІДБОРУ КОДУ:
 * Після 5 невдалих спроб логіна для одного email — блокування на 15 хв.
 * Лічильник живе в CacheService (сам скидається, нічого налаштовувати не треба).
 * ============================================================
 */

// ─── НАЛАШТУВАННЯ — заповни своїми даними ───
const MERCHANT_SECRET_KEY = 'ВСТАВ_СЕКРЕТНИЙ_КЛЮЧ_З_WAYFORPAY'; // WayForPay кабінет → Налаштування магазину → Секретний ключ
const SHEET_ID = 'ВСТАВ_ID_СВОЄЇ_ТАБЛИЦІ';
const SHEET_NAME = 'Покупці';
const PROGRESS_SHEET_NAME = 'Прогрес'; // окремий лист для прогресу курсу (створюється автоматично)
const FROM_NAME = 'Курс Amazon'; // ім'я відправника в листі клієнту

// ============================================================
// Точка входу для всіх POST-запитів
// ============================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // Якщо прийшов вебхук від WayForPay — у нього завжди є ці поля
    if (body.merchantSignature && body.transactionStatus) {
      return handleWayForPayWebhook(body);
    }

    // Інакше — запит на перевірку логіна з кабінету
    if (body.action === 'login') {
      return handleLoginCheck(body.email, body.code);
    }

    if (body.action === 'saveDisplayName') {
      return handleSaveDisplayName(body.email, body.displayName);
    }

    if (body.action === 'getProgress') {
      return handleGetProgress(body.email);
    }

    if (body.action === 'saveProgress') {
      return handleSaveProgress(body.email, body.data);
    }

    return jsonResponse({ error: 'unknown request' });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function doGet(e) {
  return ContentService.createTextOutput('WayForPay backend is running.');
}

// ============================================================
// Обробка вебхука WayForPay
// ============================================================
function handleWayForPayWebhook(data) {
  // 1. Перевіряємо підпис вхідного запиту (щоб довести, що це реально WayForPay)
  var signString = [
    data.merchantAccount, data.orderReference, data.amount, data.currency,
    data.authCode, data.cardPan, data.transactionStatus, data.reasonCode
  ].join(';');
  var expectedSignature = hmacMd5Hex(signString, MERCHANT_SECRET_KEY);

  if (expectedSignature !== data.merchantSignature) {
    // Підпис не збігається — ігноруємо запит (можлива підробка)
    return jsonResponse({ error: 'invalid signature' });
  }

  // 2. Якщо оплата успішна — видаємо доступ
  if (data.transactionStatus === 'Approved' && data.email) {
    var code = generateAccessCode();
    saveToSheet(data.email, data.orderReference, code, data.amount);
    sendAccessEmail(data.email, code);
  }

  // 3. WayForPay ЧЕКАЄ конкретну відповідь — якщо її не буде,
  //    він повторюватиме запит протягом 4 днів
  var time = Math.floor(Date.now() / 1000);
  var respSignString = [data.orderReference, 'accept', time].join(';');
  var respSignature = hmacMd5Hex(respSignString, MERCHANT_SECRET_KEY);

  return jsonResponse({
    orderReference: data.orderReference,
    status: 'accept',
    time: time,
    signature: respSignature
  });
}

// ============================================================
// Перевірка логіна з кабінету (email + код)
// ============================================================
function handleLoginCheck(email, code) {
  var cache = CacheService.getScriptCache();
  var attemptsKey = 'login_attempts_' + String(email).trim().toLowerCase();
  var attempts = Number(cache.get(attemptsKey)) || 0;

  // Захист від перебору: 5 невдалих спроб — і блокування на 15 хв
  if (attempts >= 5) {
    return jsonResponse({ success: false, error: 'too_many_attempts' });
  }

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  var rows = sheet.getDataRange().getValues();
  var emailExists = false;

  for (var i = 1; i < rows.length; i++) {
    var rowEmail = String(rows[i][0]).trim().toLowerCase();
    var rowCode = String(rows[i][2]).trim();
    var rowStatus = String(rows[i][5] || '').trim().toLowerCase();

    if (rowEmail === String(email).trim().toLowerCase()) {
      emailExists = true;
      if (rowCode === String(code).trim()) {
        if (rowStatus === 'заблоковано') {
          return jsonResponse({ success: false, error: 'blocked' });
        }
        cache.remove(attemptsKey);
        var displayName = String(rows[i][6] || '').trim();
        return jsonResponse({ success: true, email: rowEmail, displayName: displayName });
      }
    }
  }

  // Невдала спроба — рахуємо, тримаємо 15 хв (900 сек)
  cache.put(attemptsKey, String(attempts + 1), 900);
  if (!emailExists) return jsonResponse({ success: false, error: 'no_access' });
  return jsonResponse({ success: false, error: 'wrong_code' });
}

function handleSaveDisplayName(email, displayName) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  var rows = sheet.getDataRange().getValues();
  var targetEmail = String(email).trim().toLowerCase();

  for (var i = 1; i < rows.length; i++) {
    var rowEmail = String(rows[i][0]).trim().toLowerCase();
    if (rowEmail === targetEmail) {
      sheet.getRange(i + 1, 7).setValue(displayName);
      break;
    }
  }

  return jsonResponse({ success: true });
}

// ============================================================
// Прогрес курсу: читання/запис по email (окремий лист "Прогрес")
// ============================================================
function getOrCreateProgressSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(PROGRESS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PROGRESS_SHEET_NAME);
    sheet.appendRow(['Email', 'Дані (JSON)', 'Оновлено']);
  }
  return sheet;
}

function handleGetProgress(email) {
  if (!email) return jsonResponse({ success: false, error: 'no_email' });
  var sheet = getOrCreateProgressSheet();
  var rows = sheet.getDataRange().getValues();
  var target = String(email).trim().toLowerCase();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === target) {
      return jsonResponse({ success: true, data: rows[i][1] || '' });
    }
  }
  return jsonResponse({ success: true, data: '' });
}

function handleSaveProgress(email, data) {
  if (!email) return jsonResponse({ success: false, error: 'no_email' });

  // LockService: захист від гонки, якщо один учень одночасно тримає
  // відкритими дві вкладки і обидва пушать прогрес майже одночасно.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return jsonResponse({ success: false, error: 'locked' });
  }

  try {
    var sheet = getOrCreateProgressSheet();
    var rows = sheet.getDataRange().getValues();
    var target = String(email).trim().toLowerCase();
    var json = typeof data === 'string' ? data : JSON.stringify(data);
    // Захисна межа: комірка Google Sheets не тримає більше ~50000 символів,
    // а прогрес курсу — маленький блоб, тож обрізання тут — лише страховка.
    if (json.length > 45000) json = json.slice(0, 45000);

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toLowerCase() === target) {
        sheet.getRange(i + 1, 2).setValue(json);
        sheet.getRange(i + 1, 3).setValue(new Date());
        return jsonResponse({ success: true });
      }
    }
    sheet.appendRow([target, json, new Date()]);
    return jsonResponse({ success: true });
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// Допоміжні функції
// ============================================================
function generateAccessCode() {
  // Простий читабельний код на кшталт "K7F2-9XQR"
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O/1/I щоб не плутати
  var part = function () {
    var s = '';
    for (var i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  };
  return part() + '-' + part();
}

function saveToSheet(email, orderRef, code, amount) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  sheet.appendRow([email, orderRef, code, new Date(), amount, '']);
}

function sendAccessEmail(email, code) {
  var subject = 'Доступ до курсу Amazon — твій код';
  // ВСТАВ СЮДИ посилання на свій кабінет (той самий домен, де лежить cabinet.html)
  var cabinetUrl = 'https://ВСТАВ_СВІЙ_ДОМЕН/cabinet.html';
  var body =
    'Вітаємо!\n\n' +
    'Оплата пройшла успішно. Ось твій код доступу до кабінету курсу:\n\n' +
    code + '\n\n' +
    'Для входу відкрий кабінет за посиланням:\n' + cabinetUrl + '\n' +
    'і введи свій email та цей код.\n\n' +
    '— ' + FROM_NAME;
  MailApp.sendEmail(email, subject, body);
}

function hmacMd5Hex(str, key) {
  var signatureBytes = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_MD5, str, key);
  var hex = '';
  for (var i = 0; i < signatureBytes.length; i++) {
    var v = signatureBytes[i];
    if (v < 0) v += 256;
    var h = v.toString(16);
    hex += h.length === 1 ? '0' + h : h;
  }
  return hex;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
