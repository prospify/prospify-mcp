import { describe, expect, test } from "bun:test";

describe("env", () => {
	test("env module loads without error when vars are set", async () => {
		// env.ts is already loaded via server imports — just verify it doesn't throw
		// when the required vars are present (they should be from .env)
		const { env } = await import("../../src/env");
		expect(env.SUPABASE_URL).toBeTruthy();
		expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
		expect(env.MCP_SERVER_PORT).toBeGreaterThan(0);
	});
});
