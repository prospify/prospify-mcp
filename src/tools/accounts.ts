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
					"id, name, mask, type, subtype, current_balance, available_balance, iso_currency_code, item_id, is_splitwise",
				)
				.order("name");

			if (error) throw safeDbError("Fetch accounts", error);

			const itemIds = [...new Set((accounts ?? []).map((a) => a.item_id).filter(Boolean))];
			const { data: items, error: itemsError } = itemIds.length
				? await client.from("items").select("id, plaid_institution_id").in("id", itemIds)
				: { data: [], error: null };
			if (itemsError) throw safeDbError("Fetch account institutions", itemsError);
			const institutionByItem = new Map(
				(items ?? []).map((item) => [item.id, item.plaid_institution_id]),
			);

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
						institutionId: a.item_id ? (institutionByItem.get(a.item_id) ?? null) : null,
						isSplitwise: a.is_splitwise,
						card: cardMap[a.id] ?? null,
					})),
				},
				null,
				2,
			);
		},
	});
}
