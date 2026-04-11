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

describe("tool queries with user-scoped client", () => {
	test("get-transactions: query transactions view (RLS-scoped)", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("transactions")
			.select("id, name, amount, date, category, card_name, account_id")
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

	test("get-accounts: query accounts view (RLS-scoped)", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("accounts")
			.select("id, name, mask, type, subtype")
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
		if (data && data.length > 0) {
			expect(data[0].id).toBeNumber();
			expect(data[0].name).toBeString();
		}
	});

	test("get-user-profile: query user_profiles by id", async () => {
		const { client, userId } = await getClient();
		const { data, error } = await client
			.from("user_profiles")
			.select("id, age, income, credit_score")
			.eq("id", userId)
			.maybeSingle();

		expect(error).toBeNull();
		if (data) {
			expect(data.id).toBe(userId);
		}
	});

	test("get-subscriptions: query transactions for pattern detection", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("transactions")
			.select("name, amount, date, account_id, category")
			.eq("is_deleted", false)
			.gt("amount", 0)
			.order("date", { ascending: false })
			.limit(100);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("get-benefit-configs: query card_benefit_configs through user's cards", async () => {
		const { client } = await getClient();
		const { data: accounts } = await client.from("accounts").select("id");

		if (accounts && accounts.length > 0) {
			const accountIds = (accounts as Array<{ id: number }>).map((a) => a.id);
			const { data: cardDetails } = await client
				.from("credit_card_details")
				.select("card_id, account_id")
				.in("account_id", accountIds);

			if (cardDetails && cardDetails.length > 0) {
				const cardIds = [
					...new Set((cardDetails as Array<{ card_id: string }>).map((c) => c.card_id)),
				];
				const { data: configs, error } = await client
					.from("card_benefit_configs")
					.select("id, benefit_name, frequency, amount")
					.in("card_id", cardIds)
					.limit(5);

				expect(error).toBeNull();
				expect(configs).toBeArray();
			}
		}
	});

	test("get-splitwise-status: query splitwise_connections (RLS-scoped)", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("splitwise_connections")
			.select("splitwise_user_id")
			.maybeSingle();

		expect(error).toBeNull();
		// data may be null if user has no Splitwise connection
		expect(data === null || typeof data === "object").toBe(true);
	});

	test("get-linked-accounts: query linked_accounts (RLS-scoped)", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("linked_accounts")
			.select("id, status")
			.eq("status", "confirmed")
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("get-credit-matches: query credit_match_suggestions (RLS-scoped)", async () => {
		const { client } = await getClient();
		const { data, error } = await client
			.from("credit_match_suggestions")
			.select("id, confidence_score, status")
			.eq("status", "pending")
			.limit(5);

		expect(error).toBeNull();
		expect(data).toBeArray();
	});
});
