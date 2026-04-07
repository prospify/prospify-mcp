/**
 * Authentication: Google OAuth → Supabase user ID mapping.
 *
 * Users sign in with their Google account (same one used for Prospify).
 * After OAuth, we look up the corresponding Supabase user by email.
 */

import { GoogleProvider, type GoogleSession } from "fastmcp";
import { adminClient } from "./db.js";
import { env } from "./env.js";

export type { GoogleSession };

export const authProvider = new GoogleProvider({
	baseUrl: env.MCP_BASE_URL,
	clientId: env.GOOGLE_CLIENT_ID,
	clientSecret: env.GOOGLE_CLIENT_SECRET,
	scopes: ["openid", "email", "profile"],
});

// Cache email → userId mappings to avoid repeated Supabase lookups
const userIdCache = new Map<string, { userId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve Supabase user ID from Google email.
 * Cached for 5 minutes to avoid repeated auth.admin.listUsers calls.
 */
export async function resolveUserId(email: string): Promise<string> {
	const cached = userIdCache.get(email);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.userId;
	}

	const { data, error } = await adminClient.auth.admin.listUsers({
		page: 1,
		perPage: 1000,
	});

	if (error) {
		throw new Error(`Failed to look up user: ${error.message}`);
	}

	const user = data.users.find((u) => u.email === email);
	if (!user) {
		throw new Error(
			`No Prospify account found for ${email}. Please sign up at prospify.app first.`,
		);
	}

	userIdCache.set(email, {
		userId: user.id,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});

	return user.id;
}

/**
 * Helper to get userId from a session.
 * Every tool handler should call this.
 */
export async function getUserId(session: Record<string, unknown> | undefined): Promise<string> {
	const email = session?.email as string | undefined;
	if (!email) {
		throw new Error("Authentication required. Please sign in with your Google account.");
	}
	return resolveUserId(email);
}
