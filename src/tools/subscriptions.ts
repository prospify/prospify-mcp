/**
 * Subscription tools — detect and manage recurring subscriptions.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { getUserId } from "../auth.js";
import { supabase } from "../db.js";

export function registerSubscriptionTools(server: FastMCP) {
	server.addTool({
		name: "get-subscriptions",
		description:
			"Detect recurring subscriptions from transaction patterns. Uses statistical analysis of transaction frequency and amount consistency. Returns merchant name, cadence (weekly/monthly/quarterly/annual), average amount, confidence score, and active status.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const userId = await getUserId(session);

			// Run the subscription detection CTE query via Supabase RPC
			// Since this is a complex CTE, we use raw SQL via the postgrest rpc endpoint
			const { data, error } = await supabase.rpc("detect_subscriptions", {
				p_user_id: userId,
			});

			// If RPC doesn't exist, fall back to a simpler query approach
			if (error) {
				// Get transaction patterns — group by merchant, find recurring ones
				const { data: transactions, error: txErr } = await supabase
					.from("transactions")
					.select("name, amount, date, account_id, category, card_name")
					.eq("user_id", userId)
					.eq("is_deleted", false)
					.gt("amount", 0)
					.order("date", { ascending: false })
					.limit(2000);

				if (txErr) throw new Error(`Failed to fetch transactions: ${txErr.message}`);
				if (!transactions || transactions.length === 0) {
					return JSON.stringify({ subscriptions: [] });
				}

				// Group by merchant name (lowered) + account
				interface MerchantGroup {
					name: string;
					amounts: number[];
					dates: string[];
					accountId: number;
					cardName: string | null;
					category: string | null;
				}

				const groups = new Map<string, MerchantGroup>();

				for (const tx of transactions) {
					const key = `${tx.name.toLowerCase()}|${tx.account_id}`;
					const group: MerchantGroup = groups.get(key) ?? {
						name: tx.name,
						amounts: [],
						dates: [],
						accountId: tx.account_id as number,
						cardName: tx.card_name as string | null,
						category: tx.category as string | null,
					};
					group.amounts.push(Number(tx.amount));
					group.dates.push(tx.date as string);
					groups.set(key, group);
				}

				// Find recurring patterns (3+ occurrences, consistent amounts)
				const subscriptions = [];
				for (const [, group] of groups) {
					if (group.amounts.length < 3) continue;

					const avg = group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length;
					const stddev = Math.sqrt(
						group.amounts.reduce((sum, a) => sum + (a - avg) ** 2, 0) / group.amounts.length,
					);
					const cv = stddev / avg;

					if (cv > 0.2) continue; // Too much variance

					// Calculate median interval
					const sortedDates = group.dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
					const intervals = [];
					for (let i = 1; i < sortedDates.length; i++) {
						intervals.push((sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24));
					}
					if (intervals.length < 2) continue;

					intervals.sort((a, b) => a - b);
					const medianInterval = intervals[Math.floor(intervals.length / 2)];

					// Determine cadence
					let cadence: string | null = null;
					if (medianInterval >= 27 && medianInterval <= 35) cadence = "monthly";
					else if (medianInterval >= 85 && medianInterval <= 100) cadence = "quarterly";
					else if (medianInterval >= 175 && medianInterval <= 195) cadence = "semiannual";
					else if (medianInterval >= 350 && medianInterval <= 380) cadence = "annual";
					else if (medianInterval >= 6 && medianInterval <= 8) cadence = "weekly";
					else if (medianInterval >= 13 && medianInterval <= 16) cadence = "biweekly";

					if (!cadence) continue;

					const lastDate = new Date(sortedDates[sortedDates.length - 1]);
					const daysSinceLastCharge = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
					const isActive = daysSinceLastCharge <= medianInterval * 1.5;

					subscriptions.push({
						merchantName: group.name,
						cardName: group.cardName,
						accountId: group.accountId,
						cadence,
						averageAmount: Math.round(avg * 100) / 100,
						lastAmount: group.amounts[0],
						transactionCount: group.amounts.length,
						lastSeen: group.dates[0],
						isActive,
						category: group.category,
						confidence: Math.round((1 - cv) * 100),
					});
				}

				subscriptions.sort((a, b) => {
					if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
					return b.averageAmount - a.averageAmount;
				});

				return JSON.stringify({ subscriptions }, null, 2);
			}

			return JSON.stringify({ subscriptions: data }, null, 2);
		},
	});

	server.addTool({
		name: "dismiss-subscription",
		description:
			"Dismiss a detected subscription as a false positive. It will no longer appear in the subscription list.",
		annotations: { destructiveHint: false, idempotentHint: true },
		parameters: z.object({
			merchantKey: z.string().max(500).describe("Merchant name (lowercased) to dismiss"),
			accountId: z.number().describe("Account ID"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			const { error } = await supabase.from("subscription_dismissals").insert({
				user_id: userId,
				merchant_key: args.merchantKey,
				account_id: args.accountId,
			});

			if (error) throw new Error(`Failed to dismiss: ${error.message}`);
			return `Subscription "${args.merchantKey}" dismissed.`;
		},
	});

	server.addTool({
		name: "restore-subscription",
		description: "Restore a previously dismissed subscription.",
		annotations: { destructiveHint: false, idempotentHint: true },
		parameters: z.object({
			merchantKey: z.string().max(500).describe("Merchant name to restore"),
			accountId: z.number().describe("Account ID"),
		}),
		execute: async (args, { session }) => {
			const userId = await getUserId(session);

			const { error } = await supabase
				.from("subscription_dismissals")
				.delete()
				.eq("user_id", userId)
				.eq("merchant_key", args.merchantKey)
				.eq("account_id", args.accountId);

			if (error) throw new Error(`Failed to restore: ${error.message}`);
			return `Subscription "${args.merchantKey}" restored.`;
		},
	});
}
