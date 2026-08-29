// Публічні налаштування Supabase. Цей ключ можна показувати у frontend.
// Секретні ключі (service_role, Resend, WayForPay) тут зберігати не можна.
window.START_AMAZON_SUPABASE_URL = 'https://ophqbofsadeqhulrqmfl.supabase.co';
window.START_AMAZON_SUPABASE_ANON_KEY = 'sb_publishable_mlDfr-1B9EcfdiXnrMnI1Q_t3WJsgMU';

window.startAmazonSupabase = window.supabase.createClient(
  window.START_AMAZON_SUPABASE_URL,
  window.START_AMAZON_SUPABASE_ANON_KEY
);
