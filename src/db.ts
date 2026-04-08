/**
 * Supabase client for database access.
 * Uses the service role key to bypass RLS — all queries MUST filter by userId.
 *
 * When SKIP_ENV_VALIDATION=true (CI lint/type-check), uses a placeholder URL
 * so the module can be imported without throwing.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

const url = env.SUPABASE_URL || "https://placeholder.supabase.co";
const key = env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key";

export const supabase = createClient(url, key, {
	auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Admin client for user lookups (email → userId mapping).
 */
export const adminClient = createClient(url, key, {
	auth: { autoRefreshToken: false, persistSession: false },
});
