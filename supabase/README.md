# Авторизація та WayForPay

1. Створити Supabase project.
2. Виконати `schema.sql` у SQL Editor.
3. Увімкнути Email Auth і налаштувати Site URL та Redirect URLs:
   - `https://ВАШ_ДОМЕН/enter.html`
   - `https://ВАШ_ДОМЕН/cabinet.html`
4. Застосувати міграції (`supabase db push`) і розгорнути
   `functions/wayforpay-webhook`.
5. Направити на нього webhook WayForPay. Задати secrets:
   `WAYFORPAY_SECRET_KEY`, `WAYFORPAY_MERCHANT_ACCOUNT`,
   `WAYFORPAY_EXPECTED_AMOUNT`, `WAYFORPAY_EXPECTED_CURRENCY`, `APP_URL`,
   `PRODUCT_ID`, `RESEND_API_KEY` та `EMAIL_FROM`.
   `WAYFORPAY_MERCHANT_ACCOUNT` і суму потрібно скопіювати з налаштувань
   WayForPay, не вгадувати.
6. Секретні ключі зберігати тільки в secrets backend, не у frontend.
7. Перед production оплатою перевірити повторний callback: він не повинен
   змінювати пароль або надсилати другий лист, якщо перше письмо вже доставлено.

> Важливо: `cabinet.html` не може залишатися джерелом платного контенту.
> Статичний файл завантажується до браузера ще до виконання JavaScript.
> Розділи курсу потрібно винести у захищений endpoint або приватне сховище
> з видачею даних тільки для валідної Supabase session.

Очікуваний процес:

- WayForPay надсилає підтверджений webhook.
- Backend перевіряє HMAC і шукає `order_reference`.
- Повторний webhook оновлює існуюче замовлення, але не створює дубльований доступ.
- Для email створюється/активується entitlement `amazon-course`.
- Користувач отримує посилання Supabase Auth для створення пароля через налаштований SMTP.
- Frontend працює тільки з Supabase session і перевіряє entitlement.
