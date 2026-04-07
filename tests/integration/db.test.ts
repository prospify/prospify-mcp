import { describe, expect, test } from "bun:test";
import { getUserId, resolveUserId } from "../../src/auth";
import { supabase } from "../../src/db";

describe("database connection", () => {
	test("can query Supabase", async () => {
		const { data, error } = await supabase.from("user_profiles").select("id").limit(1);
		expect(error).toBeNull();
		expect(data).toBeArray();
	});
});

describe("resolveUserId", () => {
	test("resolves known user email to UUID", async () => {
		const userId = await resolveUserId("ashay@prospify.co");
		expect(userId).toBeString();
		expect(userId).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("throws for unknown email", async () => {
		expect(resolveUserId("nonexistent@example.com")).rejects.toThrow("No Prospify account found");
	});
});

describe("getUserId", () => {
	test("works with valid session", async () => {
		const userId = await getUserId({ email: "ashay@prospify.co", accessToken: "test" });
		expect(userId).toBeString();
		expect(userId.length).toBe(36);
	});
});
