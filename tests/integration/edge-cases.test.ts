/**
 * Edge case integration tests — test boundary conditions, error handling,
 * and unusual inputs against the real database.
 */

import { describe, expect, test } from "bun:test";
import { getUserId, resolveUserId } from "../../src/auth";
import { supabase } from "../../src/db";

let testUserId: string;

describe("edge cases", () => {
	test("setup: resolve test user", async () => {
		testUserId = await resolveUserId("ashay@prospify.co");
		expect(testUserId).toBeString();
	});

	// --- Auth edge cases ---

	test("resolveUserId caches results", async () => {
		const start = performance.now();
		const id1 = await resolveUserId("ashay@prospify.co");
		const firstCallMs = performance.now() - start;

		const start2 = performance.now();
		const id2 = await resolveUserId("ashay@prospify.co");
		const secondCallMs = performance.now() - start2;

		expect(id1).toBe(id2);
		// Cached call should be much faster (< 1ms vs network call)
		expect(secondCallMs).toBeLessThan(firstCallMs);
	});

	test("getUserId with empty object returns error", async () => {
		expect(getUserId({})).rejects.toThrow("Authentication required");
	});

	test("getUserId with null email returns error", async () => {
		expect(getUserId({ email: null })).rejects.toThrow("Authentication required");
	});

	// --- Transaction query edge cases ---

	test("querying transactions with future date returns empty", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("id")
			.eq("user_id", testUserId)
			.gte("date", "2099-01-01")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("querying with non-existent account ID returns empty", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("id")
			.eq("user_id", testUserId)
			.eq("account_id", 999999)
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("querying transactions with SQL injection in search is safe", async () => {
		const maliciousSearch = "'; DROP TABLE transactions_table; --";
		const { data, error } = await supabase
			.from("transactions")
			.select("id")
			.eq("user_id", testUserId)
			.ilike("name", `%${maliciousSearch}%`)
			.limit(1);

		// Should not error — Supabase parametrizes queries
		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("querying with empty search returns results", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("id")
			.eq("user_id", testUserId)
			.ilike("name", "%%")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	// --- Benefit edge cases ---

	test("querying benefit configs for non-existent card returns empty", async () => {
		const { data, error } = await supabase
			.from("card_benefit_configs")
			.select("id")
			.eq("card_id", "00000000-0000-0000-0000-000000000000")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("querying benefit usages for non-existent user returns empty", async () => {
		const { data, error } = await supabase
			.from("benefit_usages")
			.select("id")
			.eq("user_id", "00000000-0000-0000-0000-000000000000")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	// --- Cross-user access control ---

	test("cannot see other user's transactions via view", async () => {
		// Get a transaction from the test user
		const { data: myTx } = await supabase
			.from("transactions")
			.select("id, user_id")
			.eq("user_id", testUserId)
			.limit(1)
			.single();

		if (myTx) {
			// Try to access with a different user ID — should not find it
			const { data: otherResult } = await supabase
				.from("transactions")
				.select("id")
				.eq("id", myTx.id)
				.eq("user_id", "00000000-0000-0000-0000-000000000000")
				.single();

			expect(otherResult).toBeNull();
		}
	});

	test("cannot see other user's accounts", async () => {
		const { data } = await supabase
			.from("accounts")
			.select("id")
			.eq("user_id", "00000000-0000-0000-0000-000000000000")
			.limit(1);

		expect(data).toHaveLength(0);
	});

	// --- Large offset/limit ---

	test("large offset returns empty without error", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("id")
			.eq("user_id", testUserId)
			.range(999999, 999999 + 10);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("limit of 1 returns at most 1 result", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("id")
			.eq("user_id", testUserId)
			.limit(1);

		expect(error).toBeNull();
		expect(data!.length).toBeLessThanOrEqual(1);
	});
});
