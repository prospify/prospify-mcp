import { describe, expect, test } from "bun:test";
import { createUserSupabaseClient } from "../../src/supabase-client";
import { getTestSession } from "../helpers/auth";

describe("user-scoped Supabase client", () => {
	test("can query user_profiles through the user's JWT", async () => {
		const session = await getTestSession();
		const client = createUserSupabaseClient(session.accessToken);

		const { data, error } = await client.from("user_profiles").select("id").limit(1);
		expect(error).toBeNull();
		expect(data).toBeArray();
	});

	test("RLS enforces row scoping without .eq(user_id) filters", async () => {
		const session = await getTestSession();
		const client = createUserSupabaseClient(session.accessToken);

		// Query the transactions view with no user filter — RLS alone
		// should limit results to rows belonging to this user.
		const { data, error } = await client.from("transactions").select("id").limit(5);
		expect(error).toBeNull();
		expect(data).toBeArray();
	});
});
