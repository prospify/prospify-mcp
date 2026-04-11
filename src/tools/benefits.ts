/**
 * Benefit tools — track credit card rewards/benefits usage.
 *
 * Account ownership is enforced by RLS on the `accounts` view. Handlers
 * that take an `accountId` verify it by selecting from `accounts` — if
 * the user doesn't own the account, the select returns no row and we
 * throw "not found". There's no separate `verifyAccountOwnership()`
 * helper anymore because RLS makes that redundant.
 */

import type { FastMCP } from "fastmcp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ProspifySession } from "../auth.js";
import { createUserSupabaseClient } from "../supabase-client.js";
import { escapeLikePattern, safeDbError } from "../utils.js";

async function assertOwnsAccount(client: SupabaseClient, accountId: number): Promise<void> {
	const { data } = await client
		.from("accounts")
		.select("id")
		.eq("id", accountId)
		.maybeSingle();
	if (!data) throw new Error("Account not found or access denied");
}

export function registerBenefitTools(server: FastMCP<ProspifySession>) {
	server.addTool({
		name: "get-cards-with-benefits",
		description:
			"List all credit cards the user has that have tracked benefits/rewards configured. Returns card name, issuer, account ID, and mask.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data: rpcData, error: rpcErr } = await client.rpc(
				"get_user_cards_with_benefits",
				{ p_user_id: session!.userId },
			);

			if (!rpcErr && rpcData) {
				return JSON.stringify(rpcData, null, 2);
			}

			// Fallback path: query through the accounts view (RLS-scoped) and
			// intersect with cards that have active benefit configs.
			const { data: accounts, error: accErr } = await client
				.from("accounts")
				.select("id, mask");

			if (accErr) throw safeDbError("Fetch accounts", accErr);
			const accountIds = (accounts ?? []).map((a) => a.id);
			if (accountIds.length === 0) return JSON.stringify([]);

			const { data: cards, error: cardErr } = await client
				.from("credit_card_details")
				.select("account_id, card_id, open_date, credit_card_catalog(id, issuer, name)")
				.in("account_id", accountIds);

			if (cardErr) throw safeDbError("Fetch cards", cardErr);

			const cardIds = [...new Set((cards ?? []).map((c) => c.card_id))];
			const nowIso = new Date().toISOString();
			const { data: configs } = await client
				.from("card_benefit_configs")
				.select("card_id")
				.in("card_id", cardIds)
				.lte("effective_from", nowIso)
				.or(`effective_until.is.null,effective_until.gt.${nowIso}`);

			const configCardIds = new Set((configs ?? []).map((c) => c.card_id));
			const maskByAccount = new Map((accounts ?? []).map((a) => [a.id, a.mask]));

			return JSON.stringify(
				(cards ?? [])
					.filter((c) => configCardIds.has(c.card_id))
					.map((c) => {
						const catalog = c.credit_card_catalog as unknown as {
							issuer: string;
							name: string;
						};
						return {
							accountId: c.account_id,
							cardId: c.card_id,
							issuer: catalog?.issuer,
							name: catalog?.name,
							mask: maskByAccount.get(c.account_id) ?? null,
							openDate: c.open_date,
						};
					}),
				null,
				2,
			);
		},
	});

	server.addTool({
		name: "get-benefit-summary",
		description:
			"Get a summary of benefit usage for a specific credit card account. Shows year-to-date value captured vs annual fee.",
		annotations: { readOnlyHint: true },
		parameters: z.object({
			accountId: z.number().describe("Account ID of the credit card"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);
			await assertOwnsAccount(client, args.accountId);

			const { data: cardDetails } = await client
				.from("credit_card_details")
				.select("card_id, open_date, credit_card_catalog(issuer, name)")
				.eq("account_id", args.accountId)
				.maybeSingle();

			if (!cardDetails) return JSON.stringify({ card: null, totalValueCaptured: 0 });

			const now = new Date();
			const { data: configs } = await client
				.from("card_benefit_configs")
				.select("id, amount")
				.eq("card_id", cardDetails.card_id)
				.lte("effective_from", now.toISOString())
				.or(`effective_until.is.null,effective_until.gt.${now.toISOString()}`);

			const configIds = (configs ?? []).map((c) => c.id);
			const viewYear = now.getFullYear();

			const { data: usages } = await client
				.from("benefit_usages")
				.select("amount_used")
				.in("benefit_config_id", configIds)
				.gte("period_start", `${viewYear}-01-01`)
				.lte("period_end", `${viewYear + 1}-01-01`);

			const totalValueCaptured = (usages ?? []).reduce(
				(sum, u) => sum + Number(u.amount_used),
				0,
			);

			const catalog = cardDetails.credit_card_catalog as unknown as {
				issuer: string;
				name: string;
			};

			return JSON.stringify(
				{
					card: { issuer: catalog?.issuer, name: catalog?.name },
					totalValueCaptured: Math.round(totalValueCaptured * 100) / 100,
					viewYear,
				},
				null,
				2,
			);
		},
	});

	server.addTool({
		name: "get-benefit-details",
		description:
			"Get detailed benefit configs and usage for a specific card and frequency (monthly, quarterly, semiannual, annual, one_time). Shows each benefit, its period amount, how much has been used, and remaining value.",
		annotations: { readOnlyHint: true },
		parameters: z.object({
			accountId: z.number().describe("Account ID of the credit card"),
			frequency: z
				.enum(["monthly", "quarterly", "semiannual", "annual", "one_time"])
				.describe("Benefit frequency to view"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);
			await assertOwnsAccount(client, args.accountId);

			const { data: cardDetails } = await client
				.from("credit_card_details")
				.select("card_id, open_date")
				.eq("account_id", args.accountId)
				.maybeSingle();

			if (!cardDetails) return JSON.stringify([]);

			const now = new Date();

			const { data: configs } = await client
				.from("card_benefit_configs")
				.select("*")
				.eq("card_id", cardDetails.card_id)
				.eq("frequency", args.frequency)
				.lte("effective_from", now.toISOString())
				.or(`effective_until.is.null,effective_until.gt.${now.toISOString()}`)
				.order("benefit_name");

			if (!configs || configs.length === 0) return JSON.stringify([]);

			const configIds = configs.map((c) => c.id);
			const { data: usages } = await client
				.from("benefit_usages")
				.select("benefit_config_id, amount_used, plaid_transaction_id, is_manual, note, created_at")
				.in("benefit_config_id", configIds);

			const usagesByConfig = new Map<string, typeof usages>();
			for (const u of usages ?? []) {
				const list = usagesByConfig.get(u.benefit_config_id) ?? [];
				list.push(u);
				usagesByConfig.set(u.benefit_config_id, list);
			}

			const benefits = configs.map((config) => {
				const configUsages = usagesByConfig.get(config.id) ?? [];
				const totalUsed = configUsages.reduce((sum, u) => sum + Number(u.amount_used), 0);
				const amount = Number(config.amount);

				return {
					configId: config.id,
					benefitName: config.benefit_name,
					benefitKey: config.benefit_key,
					description: config.description,
					frequency: config.frequency,
					amount,
					totalUsed: Math.round(totalUsed * 100) / 100,
					remaining: Math.max(0, Math.round((amount - totalUsed) * 100) / 100),
					usagePercent: amount > 0 ? Math.min(100, Math.round((totalUsed / amount) * 100)) : 0,
					trackable: config.trackable,
					usageCount: configUsages.length,
				};
			});

			return JSON.stringify(benefits, null, 2);
		},
	});

	server.addTool({
		name: "mark-benefit-used",
		description: "Manually mark a credit card benefit as used for the current period.",
		annotations: { destructiveHint: false },
		parameters: z.object({
			benefitConfigId: z.string().uuid().describe("Benefit config ID"),
			amountUsed: z.number().positive().describe("Dollar amount used"),
			note: z.string().max(1000).optional().describe("Optional note"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);

			const { data: config } = await client
				.from("card_benefit_configs")
				.select("id, benefit_name, frequency, card_id, amount")
				.eq("id", args.benefitConfigId)
				.maybeSingle();

			if (!config) throw new Error("Benefit config not found");

			// Confirm the card referenced by this config belongs to an account
			// this user owns. credit_card_details is joined to accounts, which
			// is RLS-scoped, so a non-owner sees zero rows.
			const { data: cardOwnership } = await client
				.from("credit_card_details")
				.select("account_id")
				.eq("card_id", config.card_id)
				.maybeSingle();
			if (!cardOwnership) throw new Error("Account not found or access denied");
			await assertOwnsAccount(client, cardOwnership.account_id);

			const now = new Date();
			const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
			const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

			// Cap check: prevent over-reporting benefit usage to 2x the limit.
			const configAmount = Number(config.amount);
			if (configAmount > 0) {
				const { data: existingUsages } = await client
					.from("benefit_usages")
					.select("amount_used")
					.eq("benefit_config_id", args.benefitConfigId)
					.gte("period_start", periodStart.toISOString())
					.lte("period_end", periodEnd.toISOString());

				const totalUsed = (existingUsages ?? []).reduce(
					(sum, u) => sum + Number(u.amount_used),
					0,
				);

				if (totalUsed + args.amountUsed > configAmount * 2) {
					throw new Error(
						`Cannot mark $${args.amountUsed}: would exceed 2x the benefit amount of $${configAmount}.`,
					);
				}
			}

			const { error } = await client.from("benefit_usages").insert({
				user_id: session!.userId,
				benefit_config_id: args.benefitConfigId,
				amount_used: args.amountUsed,
				period_start: periodStart.toISOString(),
				period_end: periodEnd.toISOString(),
				is_manual: true,
				note: args.note ?? null,
			});

			if (error) throw safeDbError("Mark benefit", error);

			return `Marked $${args.amountUsed} used for "${config.benefit_name}".`;
		},
	});

	server.addTool({
		name: "run-benefit-auto-match",
		description:
			"Trigger automatic benefit matching for a credit card. Scans recent transactions and matches them to configured benefits using merchant patterns.",
		annotations: { destructiveHint: false, idempotentHint: true },
		parameters: z.object({
			accountId: z.number().describe("Account ID of the credit card"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);
			await assertOwnsAccount(client, args.accountId);

			const { data: cardDetails } = await client
				.from("credit_card_details")
				.select("card_id")
				.eq("account_id", args.accountId)
				.maybeSingle();

			if (!cardDetails) throw new Error("No card found for this account");

			const now = new Date();
			const { data: configs } = await client
				.from("card_benefit_configs")
				.select("id, benefit_name, merchant_patterns, amount, frequency")
				.eq("card_id", cardDetails.card_id)
				.lte("effective_from", now.toISOString())
				.or(`effective_until.is.null,effective_until.gt.${now.toISOString()}`)
				.not("merchant_patterns", "is", null);

			if (!configs || configs.length === 0) {
				return "No benefit configs with merchant patterns found for this card.";
			}

			const sixMonthsAgo = new Date();
			sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

			const { data: transactions } = await client
				.from("transactions")
				.select("plaid_transaction_id, name, amount, date")
				.eq("account_id", args.accountId)
				.lt("amount", 0)
				.gte("date", sixMonthsAgo.toISOString().slice(0, 10))
				.eq("is_deleted", false)
				.limit(5000);

			const configIds = configs.map((c) => c.id);
			const { data: existingUsages } = await client
				.from("benefit_usages")
				.select("plaid_transaction_id")
				.in("benefit_config_id", configIds)
				.not("plaid_transaction_id", "is", null);

			const usedTxIds = new Set((existingUsages ?? []).map((u) => u.plaid_transaction_id));

			let matchCount = 0;
			let errorCount = 0;
			const MAX_ERRORS = 20;

			for (const config of configs) {
				const patterns = config.merchant_patterns as string[];
				if (!patterns || patterns.length === 0) continue;

				let regex: RegExp;
				try {
					regex = new RegExp(patterns.join("|"), "i");
				} catch {
					continue;
				}

				for (const tx of transactions ?? []) {
					if (usedTxIds.has(tx.plaid_transaction_id)) continue;

					const txNameLower = (tx.name as string).toLowerCase();
					const matchesSimple = patterns.some((p) => txNameLower.includes(p.toLowerCase()));
					if (!matchesSimple && !regex.test(tx.name as string)) continue;

					const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
					const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

					const { error } = await client.from("benefit_usages").insert({
						user_id: session!.userId,
						benefit_config_id: config.id,
						plaid_transaction_id: tx.plaid_transaction_id,
						amount_used: Math.abs(Number(tx.amount)),
						period_start: periodStart.toISOString(),
						period_end: periodEnd.toISOString(),
						is_manual: false,
					});

					if (!error) {
						matchCount++;
						usedTxIds.add(tx.plaid_transaction_id);
						errorCount = 0;
					} else {
						errorCount++;
						if (errorCount >= MAX_ERRORS) break;
					}
				}
				if (errorCount >= MAX_ERRORS) break;
			}

			return `Auto-match complete: ${matchCount} new benefit match${matchCount !== 1 ? "es" : ""} found.`;
		},
	});

	server.addTool({
		name: "search-transactions-for-linking",
		description:
			"Search credit (negative amount) transactions on an account to find ones that can be linked to a benefit. Use this before link-transaction-to-benefit.",
		annotations: { readOnlyHint: true },
		parameters: z.object({
			accountId: z.number().describe("Account ID to search"),
			search: z.string().max(500).default("").describe("Search term to match transaction names"),
			limit: z.number().max(20).default(10).describe("Max results"),
		}),
		execute: async (args, { session }) => {
			const client = createUserSupabaseClient(session!.accessToken);
			await assertOwnsAccount(client, args.accountId);

			const { data, error } = await client
				.from("transactions")
				.select("id, plaid_transaction_id, name, amount, date")
				.eq("account_id", args.accountId)
				.lt("amount", 0)
				.eq("is_deleted", false)
				.ilike("name", `%${escapeLikePattern(args.search)}%`)
				.order("date", { ascending: false })
				.limit(args.limit);

			if (error) throw safeDbError("Search transactions", error);

			return JSON.stringify(
				(data ?? []).map((t) => ({
					id: t.id,
					plaidTransactionId: t.plaid_transaction_id,
					name: t.name,
					amount: Math.abs(Number(t.amount)),
					date: t.date,
				})),
				null,
				2,
			);
		},
	});
}
