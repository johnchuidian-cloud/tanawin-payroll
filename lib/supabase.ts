import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// null until the tanawin-payroll Supabase project is created and .env filled —
// the app then runs in "no archive" mode instead of crashing.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;
