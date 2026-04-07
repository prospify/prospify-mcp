/**
 * Credit reconciliation tools — match credits/refunds to charges.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { getUserId } from "../auth.js";
import { supabase } from "../db.js";
import { escapeLikePattern, safeDbError } from "../utils.js";

export function registerCreditTools(server: FastMCP) {
	server.addTool({
		name: "get-credit-matches",
		description:
			"Get pending credit-to-charge match suggestions. These are credits/refunds that the system has matched to charges with 70-89% confidence, awaiting user confirmation.",
		annotations: { readOnlyHint: true },
		parameters: z.object({
			limit: z.number().max(50).default(20).describe("Max results"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			const { data, error } = await supabase
				.from("credit_match_suggestions")
				.select(
					"id, credit_plaid_transaction_id, charge_plaid_transaction_id, confidence_score, credit_type, status",
				)
				.eq("user_id", userId)
				.eq("status", "pending")
				.order("confidence_score", { ascending: false })
				.limit(args.limit);

			if (error) throw safeDbError("Fetch matches", error);
			if (!data || data.length === 0) return JSON.stringify({ matches: [] });

			// Get transaction details for the matched pairs
			const allTxIds = [
				...new Set([
					...data.map((d) => d.credit_plaid_transaction_id),
					...data.map((d) => d.charge_plaid_transaction_id),
				]),
			];

			const { data: txDetails } = await supabase
				.from("transactions")
				.select("plaid_transaction_id, name, amount, date, card_name")
				.eq("user_id", userId)
				.in("plaid_transaction_id", allTxIds);

			const txMap = new Map((txDetails ?? []).map((t) => [t.plaid_transaction_id, t]));

			const matches = data.map((m) => {
				const credit = txMap.get(m.credit_plaid_transaction_id);
				const charge = txMap.get(m.charge_plaid_transaction_id);
				return {
					suggestionId: m.id,
					confidence: m.confidence_score,
					creditType: m.credit_type,
					credit: credit
						? {
								name: credit.name,
								amount: Math.abs(Number(credit.amount)),
								date: credit.date,
								cardName: credit.card_name,
							}
						: null,
					charge: charge
						? {
								name: charge.name,
								amount: Number(charge.amount),
								date: charge.date,
								cardName: charge.card_name,
							}
						: null,
				};
			});

			return JSON.stringify({ matches }, null, 2);
		},
	});

	server.addTool({
		name: "confirm-credit-match",
		description: "Confirm a credit-to-charge match suggestion. Links the credit to the charge.",
		annotations: { destructiveHint: false },
		parameters: z.object({
			suggestionId: z.string().max(200).describe("Match suggestion ID to confirm"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			// Verify ownership
			const { data: suggestion } = await supabase
				.from("credit_match_suggestions")
				.select("id, credit_plaid_transaction_id, charge_plaid_transaction_id")
				.eq("id", args.suggestionId)
				.eq("user_id", userId)
				.eq("status", "pending")
				.single();

			if (!suggestion) throw new Error("Match suggestion not found or already processed");

			// Get the credit amount (scoped to user for defense-in-depth)
			const { data: creditTx } = await supabase
				.from("transactions")
				.select("amount")
				.eq("plaid_transaction_id", suggestion.credit_plaid_transaction_id)
				.eq("user_id", userId)
				.single();

			const creditAmount = Math.abs(Number(creditTx?.amount ?? 0));

			// Create the credit link
			const { error: linkErr } = await supabase.from("transaction_credits").insert({
				user_id: userId,
				plaid_transaction_id: suggestion.charge_plaid_transaction_id,
				credit_plaid_transaction_id: suggestion.credit_plaid_transaction_id,
				credit_amount: creditAmount,
			});

			if (linkErr) throw safeDbError("Create credit link", linkErr);

			// Update suggestion status
			await supabase
				.from("credit_match_suggestions")
				.update({ status: "confirmed" })
				.eq("id", args.suggestionId);

			return "Match confirmed: credit linked to charge.";
		},
	});

	server.addTool({
		name: "reject-credit-match",
		description: "Reject a credit-to-charge match suggestion.",
		annotations: { destructiveHint: false },
		parameters: z.object({
			suggestionId: z.string().max(200).describe("Match suggestion ID to reject"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			const { error } = await supabase
				.from("credit_match_suggestions")
				.update({ status: "rejected" })
				.eq("id", args.suggestionId)
				.eq("user_id", userId)
				.eq("status", "pending");

			if (error) throw safeDbError("Reject match", error);
			return "Match suggestion rejected.";
		},
	});

	server.addTool({
		name: "get-available-credits",
		description:
			"Get available credit transactions (refunds/returns) that can be linked to charges. Useful for manual credit reconciliation.",
		annotations: { readOnlyHint: true },
		parameters: z.object({
			accountId: z.number().optional().describe("Filter by account ID"),
			search: z.string().max(500).optional().describe("Search by transaction name"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			let query = supabase
				.from("transactions")
				.select("id, plaid_transaction_id, name, amount, date, account_id, card_name")
				.eq("user_id", userId)
				.lt("amount", 0)
				.eq("is_deleted", false)
				.order("date", { ascending: false })
				.limit(50);

			if (args.accountId) query = query.eq("account_id", args.accountId);
			if (args.search) query = query.ilike("name", `%${escapeLikePattern(args.search)}%`);

			const { data, error } = await query;
			if (error) throw safeDbError("Fetch credits", error);

			return JSON.stringify(
				(data ?? []).map((t) => ({
					id: t.id,
					plaidTransactionId: t.plaid_transaction_id,
					name: t.name,
					amount: Math.abs(Number(t.amount)),
					date: t.date,
					accountId: t.account_id,
					cardName: t.card_name,
				})),
				null,
				2,
			);
		},
	});

	server.addTool({
		name: "link-credit",
		description: "Manually link a credit/refund transaction to a charge transaction.",
		annotations: { destructiveHint: false },
		parameters: z.object({
			chargeTransactionId: z.number().describe("ID of the charge transaction"),
			creditTransactionId: z.number().describe("ID of the credit/refund transaction"),
			creditAmount: z.number().positive().describe("Credit amount to apply"),
			note: z.string().max(1000).optional().describe("Optional note"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			// Get plaid_transaction_ids for both
			const { data: chargeTx } = await supabase
				.from("transactions")
				.select("plaid_transaction_id")
				.eq("id", args.chargeTransactionId)
				.eq("user_id", userId)
				.single();

			const { data: creditTx } = await supabase
				.from("transactions")
				.select("plaid_transaction_id, amount")
				.eq("id", args.creditTransactionId)
				.eq("user_id", userId)
				.single();

			if (!chargeTx || !creditTx) throw new Error("Transaction not found or access denied");

			if (Number(creditTx.amount) >= 0)
				throw new Error("Credit transaction must have a negative amount");

			const { error } = await supabase.from("transaction_credits").insert({
				user_id: userId,
				plaid_transaction_id: chargeTx.plaid_transaction_id,
				credit_plaid_transaction_id: creditTx.plaid_transaction_id,
				credit_amount: args.creditAmount,
				note: args.note ?? null,
			});

			if (error) throw safeDbError("Link credit", error);
			return "Credit linked to charge successfully.";
		},
	});
}
