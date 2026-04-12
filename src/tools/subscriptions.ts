/**
 * Subscription tools — detect and manage recurring subscriptions.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { ProspifySession } from "../auth.js";
import { createUserSupabaseClient } from "../supabase-client.js";
import { safeDbError } from "../utils.js";

export function registerSubscriptionTools(server: FastMCP<ProspifySession>) {
	server.addTool({
		name: "get-subscriptions",
		description:
			"Detect recurring subscriptions from transaction patterns. Uses statistical analysis of transaction frequency and amount consistency. Returns merchant name, cadence (weekly/monthly/quarterly/annual), average amount, confidence score, and active status.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			// Try the server-side CTE first; fall back to a JS approximation
			// if the RPC isn't available on this project.
			const { data, error } = await client.rpc("detect_subscriptions", {
				p_user_id: session!.userId,
			});

			if (error) {
				const { data: transactions, error: txErr } = await client
					.from("transactions")
					.select("name, amount, date, account_id, category, card_name")
					.eq("is_deleted", false)
					.gt("amount", 0)
					.order("date", { ascending: false })
					.limit(2000);

				if (txErr) throw safeDbError("Fetch transactions", txErr);
				if (!transactions || transactions.length === 0) {
					return JSON.stringify({ subscriptions: [] });
				}

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

				const subscriptions = [];
				for (const [, group] of groups) {
					if (group.amounts.length < 3) continue;

					const avg = group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length;
					const stddev = Math.sqrt(
						group.amounts.reduce((sum, a) => sum + (a - avg) ** 2, 0) / group.amounts.length,
					);
					const cv = stddev / avg;

					if (cv > 0.2) continue;

					const sortedDates = group.dates
						.map((d) => new Date(d).getTime())
						.sort((a, b) => a - b);
					const intervals = [];
					for (let i = 1; i < sortedDates.length; i++) {
						intervals.push((sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24));
					}
					if (intervals.length < 2) continue;

					intervals.sort((a, b) => a - b);
					const medianInterval = intervals[Math.floor(intervals.length / 2)];

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
			const client = createUserSupabaseClient(session!.accessToken);

			const { error } = await client.from("subscription_dismissals").insert({
				user_id: session!.userId,
				merchant_key: args.merchantKey,
				account_id: args.accountId,
			});

			if (error) throw safeDbError("Dismiss subscription", error);
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
			const client = createUserSupabaseClient(session!.accessToken);

			const { error } = await client
				.from("subscription_dismissals")
				.delete()
				.eq("merchant_key", args.merchantKey)
				.eq("account_id", args.accountId);

			if (error) throw safeDbError("Restore subscription", error);
			return `Subscription "${args.merchantKey}" restored.`;
		},
	});
}
