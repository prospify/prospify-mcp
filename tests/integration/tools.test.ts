import { describe, expect, test } from "bun:test";
import { resolveUserId } from "../../src/auth";
import { supabase } from "../../src/db";

// Helper to get test user's ID
let testUserId: string;

describe("tool queries", () => {
	test("setup: resolve test user", async () => {
		testUserId = await resolveUserId("ashay@prospify.co");
		expect(testUserId).toBeString();
	});

	test("get-transactions: can query transactions view", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("id, name, amount, date, category, card_name, account_id")
			.eq("user_id", testUserId)
			.eq("is_deleted", false)
			.order("date", { ascending: false })
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
		if (data && data.length > 0) {
			const tx = data[0];
			expect(tx.id).toBeNumber();
			expect(tx.name).toBeString();
			expect(tx.date).toBeString();
		}
	});

	test("get-accounts: can query accounts view", async () => {
		const { data, error } = await supabase
			.from("accounts")
			.select("id, name, mask, type, subtype")
			.eq("user_id", testUserId)
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
		if (data && data.length > 0) {
			expect(data[0].id).toBeNumber();
			expect(data[0].name).toBeString();
		}
	});

	test("get-user-profile: can query user_profiles", async () => {
		const { data, error } = await supabase
			.from("user_profiles")
			.select("id, age, income, credit_score")
			.eq("id", testUserId)
			.single();

		// Profile may not exist for test user, that's OK
		if (error?.code === "PGRST116") {
			// No rows — expected if user has no profile
			expect(true).toBe(true);
		} else {
			expect(error).toBeNull();
			if (data) {
				expect(data.id).toBe(testUserId);
			}
		}
	});

	test("get-subscriptions: can query transactions for pattern detection", async () => {
		const { data, error } = await supabase
			.from("transactions")
			.select("name, amount, date, account_id, category")
			.eq("user_id", testUserId)
			.eq("is_deleted", false)
			.gt("amount", 0)
			.order("date", { ascending: false })
			.limit(100);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("get-benefit-configs: can query card_benefit_configs", async () => {
		// First get user's cards
		const { data: accounts } = await supabase
			.from("accounts")
			.select("id")
			.eq("user_id", testUserId);

		if (accounts && accounts.length > 0) {
			const accountIds = accounts.map((a) => a.id);
			const { data: cardDetails } = await supabase
				.from("credit_card_details")
				.select("card_id, account_id")
				.in("account_id", accountIds);

			if (cardDetails && cardDetails.length > 0) {
				const cardIds = [...new Set(cardDetails.map((c) => c.card_id))];
				const { data: configs, error } = await supabase
					.from("card_benefit_configs")
					.select("id, benefit_name, frequency, amount")
					.in("card_id", cardIds)
					.limit(5);

				expect(error).toBeNull();
				expect(configs).toBeArray();
			}
		}
	});

	test("get-splitwise-status: can query splitwise_connections", async () => {
		const { data, error } = await supabase
			.from("splitwise_connections")
			.select("splitwise_user_id")
			.eq("user_id", testUserId)
			.single();

		// May not have Splitwise connected
		if (error?.code === "PGRST116") {
			expect(true).toBe(true);
		} else {
			expect(error).toBeNull();
		}
	});

	test("get-linked-accounts: can query linked_accounts", async () => {
		const { data, error } = await supabase
			.from("linked_accounts")
			.select("id, status")
			.eq("status", "confirmed")
			.or(`primary_user_id.eq.${testUserId},authorized_user_id.eq.${testUserId}`)
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("get-credit-matches: can query credit_match_suggestions", async () => {
		const { data, error } = await supabase
			.from("credit_match_suggestions")
			.select("id, confidence_score, status")
			.eq("user_id", testUserId)
			.eq("status", "pending")
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});
});
