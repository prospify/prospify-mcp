/**
 * Generate a test auth token for the MCP server.
 *
 * Usage:
 *   bun run scripts/test-auth.ts [email]
 *
 * Outputs a bearer token that can be used with the MCP inspector:
 *   npx @modelcontextprotocol/inspector --cli http://localhost:4201/mcp \
 *     --transport http \
 *     --header "Authorization: Bearer <token>" \
 *     --method tools/list
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
	console.error(
		"Missing env vars. Ensure .env has:\n  SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY\n  SUPABASE_PUBLISHABLE_KEY",
	);
	process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
	auth: { autoRefreshToken: false, persistSession: false },
});

const anon = createClient(supabaseUrl, publishableKey, {
	auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = process.argv[2] || "ashay@prospify.co";
// Generate a random password each run to avoid committing a known credential
const PASSWORD = `mcp-test-${crypto.randomUUID()}`;

async function main() {
	console.log(`Looking for user ${EMAIL}...`);
	const { data: existingUsers } = await admin.auth.admin.listUsers();
	const existing = existingUsers?.users.find((u) => u.email === EMAIL);

	if (!existing) {
		throw new Error(
			`User ${EMAIL} not found. Pass a valid email:\n  bun run scripts/test-auth.ts user@example.com`,
		);
	}

	await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });

	console.log("Signing in...");
	const { data: session, error } = await anon.auth.signInWithPassword({
		email: EMAIL,
		password: PASSWORD,
	});

	if (error || !session?.session) {
		throw new Error(`Failed to sign in: ${error?.message}`);
	}

	const { access_token, refresh_token, expires_in, user } = session.session;
	console.log(`Signed in as ${user.email} (expires in ${expires_in}s, id: ${user.id})`);

	// Write auth info
	const authDir = path.join(process.cwd(), ".auth");
	fs.mkdirSync(authDir, { recursive: true });

	const authInfo = {
		userId: user.id,
		email: user.email,
		accessToken: access_token,
		refreshToken: refresh_token,
		expiresIn: expires_in,
	};

	const outPath = path.join(authDir, "test-session.json");
	fs.writeFileSync(outPath, JSON.stringify(authInfo, null, 2));
	console.log(`Session written to ${outPath}`);

	// Also output env vars for quick use
	const envPath = path.join(authDir, "test-env.sh");
	fs.writeFileSync(
		envPath,
		[
			"# Source this for test auth vars",
			`export MCP_TEST_USER_ID="${user.id}"`,
			`export MCP_TEST_EMAIL="${user.email}"`,
			`export MCP_TEST_ACCESS_TOKEN="${access_token}"`,
			"",
		].join("\n"),
	);
	console.log(`Shell env written to ${envPath}`);

	console.log("\nUsage with MCP inspector:");
	console.log("  1. Start server: bun dev");
	console.log(
		`  2. npx @modelcontextprotocol/inspector --cli http://localhost:4201/mcp --transport http --header "Authorization: Bearer ${access_token}" --method tools/list`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
