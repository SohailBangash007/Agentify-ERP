import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True once real values (not the .env.example placeholders) are set. */
export const supabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT-REF') && !anonKey.startsWith('YOUR-'));

/** Supabase browser client (null until configured). The ERP's own API still handles staff login and data. */
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null;
