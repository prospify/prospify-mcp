/**
 * Test auth helper — generates auth tokens for testing.
 *
 * Mirrors the pattern from prospify-tools/scripts/browse-auth.ts:
 * Uses the service role key to sign in a dev user and get a session.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

const TEST_EMAIL = process.env.TEST_EMAIL || "ashay@prospify.co";
const TEST_PASSWORD = "mcp-test-session-2026";

/**
 * Get a test user session by signing in with email/password.
 * Sets a password on the user first using the admin client.
 */
export async function getTestSession() {
	const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	// Find the test user
	const { data: users } = await admin.auth.admin.listUsers();
	const user = users?.users.find((u) => u.email === TEST_EMAIL);

	if (!user) {
		throw new Error(`Test user ${TEST_EMAIL} not found in Supabase`);
	}

	// Set a password for email/password sign-in
	await admin.auth.admin.updateUserById(user.id, {
		password: TEST_PASSWORD,
	});

	// Sign in to get a session
	const { data: session, error } = await anon.auth.signInWithPassword({
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
	});

	if (error || !session?.session) {
		throw new Error(`Failed to sign in test user: ${error?.message}`);
	}

	return {
		userId: user.id,
		email: user.email!,
		accessToken: session.session.access_token,
		refreshToken: session.session.refresh_token,
	};
}

/**
 * Get a mock session object for unit tests (no real Supabase needed).
 */
export function getMockSession(overrides: Partial<{ email: string }> = {}) {
	return {
		email: overrides.email ?? "test@example.com",
		accessToken: "mock-access-token",
	};
}
