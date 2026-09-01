import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { md5 } from 'npm:js-md5';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const wayforpaySecret = Deno.env.get('WAYFORPAY_SECRET_KEY')!;
const appUrl = Deno.env.get('APP_URL')!;
const expectedMerchantAccount = Deno.env.get('WAYFORPAY_MERCHANT_ACCOUNT')!;
const expectedAmount = Deno.env.get('WAYFORPAY_EXPECTED_AMOUNT')!;
const expectedAmountNumber = Number(expectedAmount);
const expectedCurrency = Deno.env.get('WAYFORPAY_EXPECTED_CURRENCY') || 'UAH';
const productId = Deno.env.get('PRODUCT_ID') || 'amazon-course';
const resendApiKey = Deno.env.get('RESEND_API_KEY');
const emailFrom = Deno.env.get('EMAIL_FROM');
const admin = createClient(supabaseUrl, serviceRoleKey);

function hmacMd5(value: string, key: string): string {
  return md5.hmac(key, value);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sameSignature(a: string, b: string): boolean {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function configurationIsValid(): boolean {
  return Boolean(
    supabaseUrl && serviceRoleKey && wayforpaySecret && appUrl &&
    expectedMerchantAccount && Number.isFinite(expectedAmountNumber) && resendApiKey && emailFrom,
  );
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    if (!configurationIsValid()) return json({ error: 'server_not_configured' }, 500);
    const body = await request.json();
    const signatureData = [
      body.merchantAccount,
      body.orderReference,
      body.amount,
      body.currency,
      body.authCode,
      body.cardPan,
      body.transactionStatus,
      body.reasonCode,
    ].join(';');
    const expected = hmacMd5(signatureData, wayforpaySecret);

    if (!body.merchantSignature || !sameSignature(expected, String(body.merchantSignature))) {
      return json({ error: 'invalid_signature' }, 401);
    }

    const reference = String(body.orderReference || '').trim();
    const email = String(body.email || body.clientEmail || '').trim().toLowerCase();
    if (!reference || !email) return json({ error: 'invalid_payload' }, 400);

    const amount = Number(body.amount);
    const currency = String(body.currency || '').trim().toUpperCase();
    if (
      String(body.merchantAccount || '') !== expectedMerchantAccount ||
      !Number.isFinite(amount) || amount !== expectedAmountNumber ||
      currency !== expectedCurrency
    ) return json({ error: 'invalid_order' }, 400);

    // WayForPay's invoice callback examples use both reasonCode and reason.
    const reasonCode = String(body.reasonCode || body.reason || '').trim().toLowerCase();
    const approved = body.transactionStatus === 'Approved'
      && (reasonCode === '1100' || reasonCode === 'ok');
    const { data: existing, error: existingError } = await admin
      .from('orders')
      .select('order_reference,status,access_email_sent_at,temporary_password_created_at')
      .eq('order_reference', reference)
      .maybeSingle();
    if (existingError) throw existingError;

        const status = approved
      ? 'approved'
      : (body.transactionStatus === 'Refunded' ? 'refunded' : 'declined');
    const { error: orderError } = await admin.from('orders').upsert({
      order_reference: reference,
      email,
      amount,
      currency,
      merchant_account: body.merchantAccount || null,
      status,
      paid_at: approved ? new Date().toISOString() : null,
      raw_payload: body,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'order_reference' });
    if (orderError) throw orderError;

    if (approved) {
      const { error: entitlementError } = await admin.from('entitlements').upsert({
        email,
        product: productId,
        status: 'active',
        source_order_reference: reference,
        granted_at: new Date().toISOString(),
        revoked_at: null,
      }, { onConflict: 'email_normalized,product' });
      if (entitlementError) throw entitlementError;

      if (existing?.status === 'approved' && existing.access_email_sent_at) {
        return wayforpayResponse(reference);
      }

      let temporaryPassword = '';
      let user = null;
      const userResult = await admin.auth.admin.getUserByEmail(email);
      if (userResult.error && !/not found|user not found/i.test(userResult.error.message)) throw userResult.error;
      user = userResult.data?.user || null;
      if (!user) {
        temporaryPassword = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8);
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          password: temporaryPassword,
        });
        if (createError) throw createError;
        user = created.user;
      } else if (!existing?.access_email_sent_at) {
        temporaryPassword = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8);
        const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
          password: temporaryPassword,
          email_confirm: true,
        });
        if (updateError) throw updateError;
      }

      if (!temporaryPassword && !existing?.access_email_sent_at) {
        throw new Error('temporary_password_unavailable');
      }
      const cabinetUrl = `${appUrl.replace(/\/+$/, '')}/cabinet.html`;
      const safeEmail = escapeHtml(email);
      const safePassword = escapeHtml(temporaryPassword);
      const mail = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
              subject: 'Доступ до курсу Amazon активовано',
              html: `<!doctype html>
<html lang="uk">
  <body style="margin:0;background:#f4f1eb;font-family:Arial,Helvetica,sans-serif;color:#171717">
    <div style="padding:32px 16px">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(20,20,20,.08)">
        <div style="padding:28px 32px;background:#171717;color:#ffffff">
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#d9ae63">Старт на Amazon</div>
          <div style="margin-top:10px;font-size:26px;font-weight:700">Доступ активовано</div>
        </div>
        <div style="padding:32px">
          <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#e7f7ed;color:#18733b;font-size:13px;font-weight:700">Оплату підтверджено ✓</div>
          <h1 style="margin:22px 0 12px;font-size:25px;line-height:1.2">Вітаємо на курсі Amazon!</h1>
          <p style="margin:0;color:#5c5c5c;font-size:16px;line-height:1.6">Ось дані для входу до особистого кабінету. Пароль тимчасовий — його можна змінити пізніше.</p>
          <div style="margin-top:22px;padding:18px 20px;border-radius:12px;background:#f5f3ee;font-size:15px;line-height:1.8">
            <div><strong>Email:</strong> ${safeEmail}</div>
            <div><strong>Тимчасовий пароль:</strong> <span style="font-family:monospace;word-break:break-all">${safePassword}</span></div>
          </div>
          <div style="padding:24px 0 8px;text-align:center">
            <a href="${cabinetUrl}" style="display:inline-block;padding:15px 24px;border-radius:12px;background:#d9ae63;color:#171717;text-decoration:none;font-size:16px;font-weight:700">Увійти до кабінету</a>
          </div>
          <p style="margin:22px 0 0;color:#8a8a8a;font-size:13px;line-height:1.5">Якщо кнопка не відкривається, відкрий кабінет вручну та введи email і тимчасовий пароль.</p>
        </div>
        <div style="padding:20px 32px;background:#fafafa;color:#8a8a8a;font-size:12px;line-height:1.5">Це автоматичний лист після оплати курсу «Старт на Amazon».</div>
      </div>
    </div>
  </body>
</html>`,
        }),
      });
      if (!mail.ok) throw new Error(`email_delivery_failed_${mail.status}`);
      const { error: deliveryStateError } = await admin.from('orders').update({
        access_email_sent_at: new Date().toISOString(),
        temporary_password_created_at: existing?.temporary_password_created_at || new Date().toISOString(),
      }).eq('order_reference', reference);
      if (deliveryStateError) throw deliveryStateError;
    } else if (status === 'refunded') {
      const { error: revokeError } = await admin
        .from('entitlements')
        .update({ status: 'refunded', revoked_at: new Date().toISOString() })
        .eq('email_normalized', email)
        .eq('product', productId);
      if (revokeError) throw revokeError;
    }

    return wayforpayResponse(reference);
  } catch (error) {
    console.error(error);
    return json({ error: 'internal_error' }, 500);
  }
});

function wayforpayResponse(orderReference: string) {
  const time = Math.floor(Date.now() / 1000);
  const signature = hmacMd5(`${orderReference};accept;${time}`, wayforpaySecret);
  return json({ orderReference, status: 'accept', time, signature });
}
