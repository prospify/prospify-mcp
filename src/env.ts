/**
 * Environment variable validation and access.
 * Fails fast at startup if required vars are missing.
 */

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function optional(name: string, defaultValue: string): string {
	return process.env[name] || defaultValue;
}

export const env = {
	SUPABASE_URL: required("SUPABASE_URL"),
	SUPABASE_PUBLISHABLE_KEY: required("SUPABASE_PUBLISHABLE_KEY"),
	SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
	GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
	GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
	MCP_SERVER_PORT: Number.parseInt(optional("MCP_SERVER_PORT", "4201"), 10),
	MCP_BASE_URL: optional("MCP_BASE_URL", "http://localhost:4201"),
};
