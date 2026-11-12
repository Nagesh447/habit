// Paste your two values from Supabase: Project Settings -> API Keys (or the "Connect" button).
// The publishable / anon key is DESIGNED to be public; the database security rules protect your data.
// NEVER put the secret / service_role key here.
window.APP_CONFIG = {
  SUPABASE_URL: '',       // e.g. 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: '',  // starts with 'sb_publishable_...' or 'eyJ...'
  // Public half of your reminder key (already filled in). The private half goes in Supabase secrets, never here.
  VAPID_PUBLIC_KEY: 'BF6Mc3mkOX_wzJZd-FpWqo8J5by0LA4iRwcANDx-EGOtdwOeabRsaMUvCafp6pgC5-BjosimbqEVq6xOYyjNr-E'
};
