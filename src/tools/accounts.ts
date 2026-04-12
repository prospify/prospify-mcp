/**
 * Account tools — list connected accounts and institutions.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { ProspifySession } from "../auth.js";
import { createUserSupabaseClient } from "../supabase-client.js";
import { safeDbError } from "../utils.js";

export function registerAccountTools(server: FastMCP<ProspifySession>) {
	server.addTool({
		name: "get-accounts",
		description:
			"List all connected bank accounts and credit cards. Shows account name, type, balance, mask (last 4 digits), and associated institution.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data: accounts, error } = await client
				.from("accounts")
				.select(
					"id, name, mask, type, subtype, current_balance, available_balance, iso_currency_code, plaid_institution_id, item_id, is_splitwise",
				)
				.order("name");

			if (error) throw safeDbError("Fetch accounts", error);

			const institutionIds = [
				...new Set((accounts ?? []).map((a) => a.plaid_institution_id).filter(Boolean)),
			];

			let logoMap: Record<string, string> = {};
			if (institutionIds.length > 0) {
				const { data: logos } = await client
					.from("institution_logos")
					.select("plaid_institution_id, logo_base64")
					.in("plaid_institution_id", institutionIds);

				logoMap = Object.fromEntries(
					(logos ?? []).map((l) => [l.plaid_institution_id, l.logo_base64]),
				);
			}

			const accountIds = (accounts ?? []).map((a) => a.id);
			const { data: cardDetails } = await client
				.from("credit_card_details")
				.select("account_id, card_id, credit_card_catalog(issuer, name)")
				.in("account_id", accountIds);

			const cardMap: Record<number, { issuer: string; name: string }> = {};
			for (const cd of cardDetails ?? []) {
				const catalog = cd.credit_card_catalog as unknown as {
					issuer: string;
					name: string;
				} | null;
				if (catalog) {
					cardMap[cd.account_id] = { issuer: catalog.issuer, name: catalog.name };
				}
			}

			return JSON.stringify(
				{
					count: accounts?.length ?? 0,
					accounts: (accounts ?? []).map((a) => ({
						id: a.id,
						name: a.name,
						mask: a.mask,
						type: a.type,
						subtype: a.subtype,
						currentBalance: a.current_balance ? Number(a.current_balance) : null,
						availableBalance: a.available_balance ? Number(a.available_balance) : null,
						currency: a.iso_currency_code,
						isSplitwise: a.is_splitwise,
						card: cardMap[a.id] ?? null,
						institutionLogo: a.plaid_institution_id
							? logoMap[a.plaid_institution_id] ?? null
							: null,
					})),
				},
				null,
				2,
			);
		},
	});
}
