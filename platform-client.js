// Public browser configuration. Secret service-role, email and payment keys
// must never be added to this file.
window.START_AMAZON_SUPABASE_URL = 'https://ophqbofsadeqhulrqmfl.supabase.co';
window.START_AMAZON_SUPABASE_ANON_KEY = 'sb_publishable_mlDfr-1B9EcfdiXnrMnI1Q_t3WJsgMU';

window.startAmazonSupabase = window.supabase.createClient(
  window.START_AMAZON_SUPABASE_URL,
  window.START_AMAZON_SUPABASE_ANON_KEY
);
