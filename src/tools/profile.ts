/**
 * User profile tools.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { ProspifySession } from "../auth.js";
import { createUserSupabaseClient } from "../supabase-client.js";
import { safeDbError } from "../utils.js";

export function registerProfileTools(server: FastMCP<ProspifySession>) {
	server.addTool({
		name: "get-user-profile",
		description:
			"Get the user's Prospify profile information including age, income, and credit score range.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data, error } = await client
				.from("user_profiles")
				.select("id, age, income, credit_score, created_at")
				.eq("id", session!.userId)
				.maybeSingle();

			if (error || !data) {
				return JSON.stringify({ profile: null, message: "No profile found." });
			}

			return JSON.stringify(
				{
					profile: {
						age: data.age,
						income: data.income,
						creditScore: data.credit_score,
						createdAt: data.created_at,
					},
				},
				null,
				2,
			);
		},
	});

	server.addTool({
		name: "get-linked-accounts",
		description:
			"Get confirmed linked accounts (primary cardholder + authorized user relationships).",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			// RLS on linked_accounts already scopes to rows where the user is
			// either primary or authorized; no explicit filter needed.
			const { data, error } = await client
				.from("linked_accounts")
				.select(
					"id, primary_account_id, authorized_account_id, primary_user_name, authorized_user_name, status, confirmed_at",
				)
				.eq("status", "confirmed");

			if (error) throw safeDbError("Fetch linked accounts", error);

			return JSON.stringify(
				(data ?? []).map((link) => ({
					id: link.id,
					primaryAccountId: link.primary_account_id,
					authorizedAccountId: link.authorized_account_id,
					primaryUserName: link.primary_user_name,
					authorizedUserName: link.authorized_user_name,
					confirmedAt: link.confirmed_at,
				})),
				null,
				2,
			);
		},
	});
}
