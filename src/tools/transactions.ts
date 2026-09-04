/**
 * Transaction tools — query and manage transactions.
 *
 * Every handler builds a per-request Supabase client from the authenticated
 * user's JWT (see ../supabase-client.ts). All user scoping is enforced by
 * RLS via `auth.uid()` — there are deliberately no `.eq("user_id", ...)`
 * filters in this file; adding them would be redundant and would mask RLS
 * policy gaps if any ever slipped in.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { ProspifySession } from "../auth.js";
import { env } from "../env.js";
import { createUserSupabaseClient } from "../supabase-client.js";
import { escapeLikePattern, safeDbError } from "../utils.js";

export function registerTransactionTools(server: FastMCP<ProspifySession>) {
	server.addTool({
		name: "refresh-transactions",
		description:
			"Force-refresh the user's connected bank and credit-card transactions from Plaid. Returns counts of added, modified, and removed transactions.",
		annotations: { destructiveHint: false, idempotentHint: false },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const response = await fetch(
				`${env.PROSPIFY_APP_URL.replace(/\/$/, "")}/api/mcp/refresh-transactions`,
				{
					method: "POST",
					headers: { Authorization: `Bearer ${session!.accessToken}` },
				},
			);

			const body = (await response.json().catch(() => null)) as
				| { error?: string; success?: boolean; addedCount?: number; modifiedCount?: number; removedCount?: number }
				| null;
			if (!response.ok) {
				throw new Error(body?.error || `Transaction refresh failed (${response.status})`);
			}

			return JSON.stringify(body, null, 2);
		},
	});

	server.addTool({
		name: "get-transactions",
		description:
			"List the user's transactions with optional filters. Returns transaction name, amount, date, category, account, and split info. Amounts are positive for debits (money spent) and negative for credits/refunds.",
		annotations: { readOnlyHint: true },
		parameters: z.object({
			accountId: z.number().optional().describe("Filter by account ID"),
			startDate: z.string().max(10).optional().describe("Start date (YYYY-MM-DD)"),
			endDate: z.string().max(10).optional().describe("End date (YYYY-MM-DD)"),
			search: z.string().max(500).optional().describe("Search by transaction name"),
			category: z.string().max(100).optional().describe("Filter by category (e.g. FOOD_AND_DRINK)"),
			limit: z.number().max(100).default(50).describe("Max results (default 50, max 100)"),
			offset: z.number().min(0).default(0).describe("Pagination offset"),
			includeDeleted: z.boolean().default(false).describe("Include soft-deleted transactions"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			let query = client
				.from("transactions")
				.select(
					"id, plaid_transaction_id, name, amount, effective_amount, date, category, subcategory, card_name, mask, is_splitwise, is_deleted, is_edited, splits, total_credits, credits, pending, logo_url, account_id, is_authorized_user_transaction",
				)
				.order("date", { ascending: false });

			if (!args.includeDeleted) {
				query = query.eq("is_deleted", false);
			}
			if (args.accountId) {
				query = query.eq("account_id", args.accountId);
			}
			if (args.startDate) {
				query = query.gte("date", args.startDate);
			}
			if (args.endDate) {
				query = query.lte("date", args.endDate);
			}
			if (args.search) {
				query = query.ilike("name", `%${escapeLikePattern(args.search)}%`);
			}
			if (args.category) {
				query = query.eq("category", args.category);
			}

			query = query.range(args.offset, args.offset + args.limit - 1);

			const { data, error } = await query;
			if (error) throw safeDbError("Fetch transactions", error);

			return JSON.stringify(
				{
					count: data?.length ?? 0,
					transactions: (data ?? []).map((t) => ({
						id: t.id,
						plaidTransactionId: t.plaid_transaction_id,
						name: t.name,
						amount: Number(t.amount),
						effectiveAmount: Number(t.effective_amount),
						date: t.date,
						category: t.category,
						subcategory: t.subcategory,
						cardName: t.card_name,
						accountMask: t.mask,
						accountId: t.account_id,
						isSplitwise: t.is_splitwise,
						isDeleted: t.is_deleted,
						isEdited: t.is_edited,
						hasSplit: !!t.splits,
						totalCredits: Number(t.total_credits ?? 0),
						pending: t.pending,
						isAuthorizedUserTransaction: t.is_authorized_user_transaction,
					})),
				},
				null,
				2,
			);
		},
	});

	server.addTool({
		name: "edit-transaction",
		description:
			"Edit a transaction's display name, amount, or date. Changes are stored as overrides — original data is preserved.",
		annotations: { destructiveHint: false, idempotentHint: true },
		parameters: z.object({
			transactionId: z.number().describe("Transaction ID (integer)"),
			name: z.string().max(500).optional().describe("New display name"),
			amount: z.number().positive().optional().describe("New amount (positive number)"),
			date: z.string().max(10).optional().describe("New date (YYYY-MM-DD)"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			// RLS ensures the lookup only returns the transaction if the user
			// owns it; any other row appears as "not found".
			const { data: tx, error: txErr } = await client
				.from("transactions")
				.select("id, plaid_transaction_id, name, amount, date, account_id")
				.eq("id", args.transactionId)
				.maybeSingle();

			if (txErr || !tx) throw new Error("Transaction not found or access denied");

			const overrideData: Record<string, unknown> = {
				plaid_transaction_id: tx.plaid_transaction_id,
				user_id: session!.userId,
				original_name: tx.name,
				original_amount: Number(tx.amount),
				original_date: tx.date,
				original_account_id: tx.account_id,
				updated_at: new Date().toISOString(),
			};

			if (args.name) overrideData.edited_name = args.name;
			if (args.amount) overrideData.edited_amount = args.amount;
			if (args.date) overrideData.edited_date = args.date;

			const { error: upsertErr } = await client
				.from("transaction_overrides")
				.upsert(overrideData, { onConflict: "plaid_transaction_id" });

			if (upsertErr) throw safeDbError("Edit transaction", upsertErr);

			return `Transaction ${args.transactionId} updated successfully.`;
		},
	});

	server.addTool({
		name: "delete-transaction",
		description:
			"Soft-delete a transaction (hide it from views). Can be restored later with restore-transaction.",
		annotations: { destructiveHint: true, idempotentHint: true },
		parameters: z.object({
			transactionId: z.number().describe("Transaction ID to delete"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data: tx, error: txErr } = await client
				.from("transactions")
				.select("id, plaid_transaction_id, name, amount, date, account_id")
				.eq("id", args.transactionId)
				.maybeSingle();

			if (txErr || !tx) throw new Error("Transaction not found or access denied");

			const { error } = await client.from("transaction_overrides").upsert(
				{
					plaid_transaction_id: tx.plaid_transaction_id,
					user_id: session!.userId,
					is_deleted: true,
					original_name: tx.name,
					original_amount: Number(tx.amount),
					original_date: tx.date,
					original_account_id: tx.account_id,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "plaid_transaction_id" },
			);

			if (error) throw safeDbError("Delete transaction", error);
			return `Transaction "${tx.name}" deleted.`;
		},
	});

	server.addTool({
		name: "restore-transaction",
		description: "Restore a previously deleted transaction.",
		annotations: { destructiveHint: false, idempotentHint: true },
		parameters: z.object({
			transactionId: z.number().describe("Transaction ID to restore"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data: tx } = await client
				.from("transactions")
				.select("plaid_transaction_id")
				.eq("id", args.transactionId)
				.maybeSingle();

			if (!tx) throw new Error("Transaction not found or access denied");

			const { error } = await client
				.from("transaction_overrides")
				.delete()
				.eq("plaid_transaction_id", tx.plaid_transaction_id);

			if (error) throw safeDbError("Restore transaction", error);
			return `Transaction ${args.transactionId} restored.`;
		},
	});

	server.addTool({
		name: "change-category",
		description:
			"Change a transaction's category. Optionally apply the same category to all transactions from the same merchant.",
		annotations: { destructiveHint: false, idempotentHint: true },
		parameters: z.object({
			transactionId: z.number().describe("Transaction ID"),
			newCategory: z
				.string()
				.max(100)
				.regex(
					/^[A-Z][A-Z0-9_]*$/,
					"Category must be uppercase with underscores (e.g. FOOD_AND_DRINK)",
				)
				.describe("New category (e.g. FOOD_AND_DRINK, TRAVEL, ENTERTAINMENT)"),
			applyToAll: z
				.boolean()
				.default(false)
				.describe("Apply this category to all transactions from this merchant"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data: tx } = await client
				.from("transactions")
				.select("id, name, account_id")
				.eq("id", args.transactionId)
				.maybeSingle();

			if (!tx) throw new Error("Transaction not found or access denied");

			// RLS on transactions_table only lets the user touch their own rows;
			// the account_id equality guards against the (already impossible)
			// case where a stray update could straddle accounts.
			const { error } = await client
				.from("transactions_table")
				.update({ category: args.newCategory, updated_at: new Date().toISOString() })
				.eq("id", tx.id)
				.eq("account_id", tx.account_id);

			if (error) throw new Error("Failed to update category. Please try again.");

			if (args.applyToAll) {
				await client.from("category_rules").upsert(
					{
						user_id: session!.userId,
						merchant_name: tx.name,
						category: args.newCategory,
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "user_id,merchant_name" },
				);
			}

			return `Category changed to ${args.newCategory}${args.applyToAll ? " (applied to all matching transactions)" : ""}.`;
		},
	});
}
