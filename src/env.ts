/**
 * Environment variable validation and access.
 * Fails fast at startup if required vars are missing.
 *
 * Set SKIP_ENV_VALIDATION=true to skip validation (for CI lint/type-check).
 *
 * The MCP server only needs *public* Supabase values. Authentication is
 * delegated to Supabase's built-in OAuth 2.1 server; the MCP server is a
 * pure Protected Resource that verifies JWTs via JWKS and creates
 * user-scoped Supabase clients for each request. RLS handles row-level
 * security end-to-end.
 */

const skipValidation = process.env.SKIP_ENV_VALIDATION === "true";

function required(name: string): string {
	const value = process.env[name];
	if (!value && !skipValidation) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value || "";
}

function optional(name: string, defaultValue: string): string {
	return process.env[name] || defaultValue;
}

function optionalList(name: string): string[] {
	const raw = process.env[name];
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export const env = {
	SUPABASE_URL: required("SUPABASE_URL"),
	SUPABASE_PUBLISHABLE_KEY: required("SUPABASE_PUBLISHABLE_KEY"),
	/**
	 * Optional allowlist of Supabase OAuth client IDs that may call this MCP
	 * server. Empty = accept any OAuth-issued token (required for Dynamic
	 * Client Registration from Claude Desktop / Claude Code). Set this in
	 * production if you want to pin access to a specific registered client.
	 */
	MCP_ALLOWED_CLIENT_IDS: optionalList("MCP_ALLOWED_CLIENT_IDS"),
	MCP_SERVER_PORT: Number.parseInt(optional("MCP_SERVER_PORT", "4201"), 10),
	MCP_BASE_URL: optional("MCP_BASE_URL", "http://localhost:4201"),
};
