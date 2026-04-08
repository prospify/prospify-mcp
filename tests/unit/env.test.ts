import { describe, expect, test } from "bun:test";

describe("env", () => {
	test("env module loads without error", async () => {
		const { env } = await import("../../src/env");
		// In CI with SKIP_ENV_VALIDATION=true, values may be empty strings
		// In local dev, they should be populated from .env
		expect(env.MCP_SERVER_PORT).toBeGreaterThan(0);
		expect(typeof env.SUPABASE_URL).toBe("string");
		expect(typeof env.SUPABASE_SERVICE_ROLE_KEY).toBe("string");
	});
});
