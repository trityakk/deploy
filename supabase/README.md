# Авторизація та WayForPay

1. Створити Supabase project.
2. Виконати `schema.sql` у SQL Editor.
3. Увімкнути Email Auth і налаштувати Site URL та Redirect URLs:
   - `https://ВАШ_ДОМЕН/enter.html`
   - `https://ВАШ_ДОМЕН/cabinet.html`
4. Розгорнути `functions/wayforpay-webhook` і направити на нього webhook WayForPay.
   Задати secrets: `WAYFORPAY_SECRET_KEY` та `APP_URL`.
5. Секретний ключ WayForPay зберігати тільки в secrets backend, не у frontend.
6. Додати secrets для листів: `RESEND_API_KEY` та `EMAIL_FROM`.

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
