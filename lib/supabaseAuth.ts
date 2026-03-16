import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAuthKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL in environment.");
}

if (!supabaseAuthKey) {
  throw new Error(
    "Missing SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY in environment."
  );
}

export const supabaseAuth = createClient(supabaseUrl, supabaseAuthKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
