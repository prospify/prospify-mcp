/**
 * Edge case integration tests — boundary conditions, error handling,
 * unusual inputs, and cross-user access control against the real DB.
 *
 * All queries use a user-scoped Supabase client built from a real JWT;
 * row-level security is the only access control layer — if any of the
 * "cannot see other user's data" tests start returning rows, RLS
 * regressed and we have a security incident.
 */

import { describe, expect, test } from "bun:test";
import { createUserSupabaseClient } from "../../src/supabase-client";
import { getTestSession } from "../helpers/auth";

let accessToken: string;
let userId: string;

async function getClient() {
	if (!accessToken) {
		const session = await getTestSession();
		accessToken = session.accessToken;
		userId = session.userId;
	}
	return { client: createUserSupabaseClient(accessToken), userId };
}

describe("edge cases", () => {
	// --- Transaction query edge cases ---

	test("querying transactions with future date returns empty", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("transactions")
			.select("id")
			.gte("date", "2099-01-01")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("querying with non-existent account ID returns empty", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("transactions")
			.select("id")
			.eq("account_id", 999999)
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("SQL injection in search stays parameterized", async () => {
		const { client } = await getClient();
		const maliciousSearch = "'; DROP TABLE transactions_table; --";
		const { data, error } = await client
			.from("transactions")
			.select("id")
			.ilike("name", `%${maliciousSearch}%`)
			.limit(1);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("empty search pattern is well-formed", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("transactions")
			.select("id")
			.ilike("name", "%%")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	// --- Benefit edge cases ---

	test("querying benefit configs for non-existent card returns empty", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("card_benefit_configs")
			.select("id")
			.eq("card_id", "00000000-0000-0000-0000-000000000000")
			.limit(1);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	// --- Cross-user access control via RLS ---

	test("cannot see transactions scoped to another user id", async () => {
		const { client } = await getClient();
		// Attempt to force an equality on a different user_id — RLS
		// masks rows owned by other users, so this must return empty.
		const { data } = await client
			.from("transactions")
			.select("id")
			.eq("user_id", "00000000-0000-0000-0000-000000000000")
			.limit(1);

		expect(data).toHaveLength(0);
	});

	test("cannot see accounts scoped to another user id", async () => {
		const { client } = await getClient();
		const { data } = await client
			.from("accounts")
			.select("id")
			.eq("user_id", "00000000-0000-0000-0000-000000000000")
			.limit(1);

		expect(data).toHaveLength(0);
	});

	test("unauthenticated client cannot see any transactions", async () => {
		// Build a client with a deliberately invalid token to prove RLS
		// blocks non-authenticated queries entirely.
		const bogusClient = createUserSupabaseClient("not-a-real-jwt");
		const { data, error } = await bogusClient.from("transactions").select("id").limit(1);
		// Supabase may return an auth error or an empty set; either is
		// acceptable — what matters is that NO rows leak.
		if (error) {
			expect(error).toBeTruthy();
		} else {
			expect(data).toHaveLength(0);
		}
	});

	// --- Large offset/limit ---

	test("large offset returns empty without error", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("transactions")
			.select("id")
			.range(999999, 999999 + 10);

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});

	test("limit of 1 returns at most 1 result", async () => {
		const { client } = await getClient();
		const { data, error } = await client.from("transactions").select("id").limit(1);

		expect(error).toBeNull();
		expect(data?.length ?? 0).toBeLessThanOrEqual(1);
	});
});
