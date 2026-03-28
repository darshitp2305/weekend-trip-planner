import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAuthKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL in environment.");
}

if (!supabaseAuthKey) {
  throw new Error(
    "Missing SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in environment."
  );
}

export const supabaseAuth = createClient(supabaseUrl, supabaseAuthKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
