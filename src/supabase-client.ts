/**
 * Per-request Supabase client factory.
 *
 * Each tool handler calls `createUserSupabaseClient(session.accessToken)`
 * and uses the returned client for queries. The user's JWT is attached as
 * `Authorization: Bearer <jwt>` on every request, so Supabase's RLS
 * policies enforce row-level security via `auth.uid()`. There is no
 * service role key anywhere in this server — a compromise leaks nothing
 * beyond the public anon key.
 */

import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function createUserSupabaseClient(accessToken: string): SupabaseClient {
	return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
		global: {
			headers: { Authorization: `Bearer ${accessToken}` },
		},
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});
}
