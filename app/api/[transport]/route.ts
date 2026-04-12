/**
 * MCP handler for Vercel — registers all Prospify tools with mcp-handler
 * and wraps with Supabase JWT verification.
 *
 * Tool logic is imported from src/tools/ — the execute functions stay
 * identical; only the registration wrapper changes (FastMCP → mcp-handler).
 */

// Force Node.js runtime — jose/supabase-js need process.env and Node APIs
export const runtime = "nodejs";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

// Lazy JWKS
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
	}
	return jwks;
}

function createUserClient(token: string) {
	return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
		global: { headers: { Authorization: `Bearer ${token}` } },
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

function escapeLikePattern(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function safeDbError(operation: string, error: { message: string; code?: string }): Error {
	console.error(`[${operation}] DB error:`, error.message, error.code ?? "");
	return new Error(`${operation} failed. Please try again.`);
}

function text(data: unknown) {
	return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

// ---------- Handler ----------

const handler = createMcpHandler(
	(server) => {
		// ── Transactions ──

		server.tool(
			"get-transactions",
			"List the user's transactions with optional filters. Amounts are positive for debits and negative for credits/refunds.",
			{
				accountId: z.number().optional().describe("Filter by account ID"),
				startDate: z.string().max(10).optional().describe("Start date (YYYY-MM-DD)"),
				endDate: z.string().max(10).optional().describe("End date (YYYY-MM-DD)"),
				search: z.string().max(500).optional().describe("Search by transaction name"),
				category: z.string().max(100).optional().describe("Filter by category"),
				limit: z.number().max(100).default(50).describe("Max results"),
				offset: z.number().min(0).default(0).describe("Pagination offset"),
				includeDeleted: z.boolean().default(false).describe("Include soft-deleted"),
			},
			async (args, extra) => {
				const client = createUserClient(extra.authInfo!.token);
				let query = client
					.from("transactions")
					.select("id, plaid_transaction_id, name, amount, effective_amount, date, category, subcategory, card_name, mask, is_splitwise, is_deleted, is_edited, splits, total_credits, credits, pending, logo_url, account_id, is_authorized_user_transaction")
					.order("date", { ascending: false });
				if (!args.includeDeleted) query = query.eq("is_deleted", false);
				if (args.accountId) query = query.eq("account_id", args.accountId);
				if (args.startDate) query = query.gte("date", args.startDate);
				if (args.endDate) query = query.lte("date", args.endDate);
				if (args.search) query = query.ilike("name", `%${escapeLikePattern(args.search)}%`);
				if (args.category) query = query.eq("category", args.category);
				query = query.range(args.offset, args.offset + args.limit - 1);
				const { data, error } = await query;
				if (error) throw safeDbError("Fetch transactions", error);
				return text({
					count: data?.length ?? 0,
					transactions: (data ?? []).map((t) => ({
						id: t.id, plaidTransactionId: t.plaid_transaction_id, name: t.name,
						amount: Number(t.amount), effectiveAmount: Number(t.effective_amount),
						date: t.date, category: t.category, subcategory: t.subcategory,
						cardName: t.card_name, accountMask: t.mask, accountId: t.account_id,
						isSplitwise: t.is_splitwise, isDeleted: t.is_deleted, isEdited: t.is_edited,
						hasSplit: !!t.splits, totalCredits: Number(t.total_credits ?? 0),
						pending: t.pending, isAuthorizedUserTransaction: t.is_authorized_user_transaction,
					})),
				});
			},
		);

		server.tool("get-accounts", "List all connected bank accounts and credit cards.", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data: accounts, error } = await client
				.from("accounts")
				.select("id, name, mask, type, subtype, current_balance, available_balance, iso_currency_code, plaid_institution_id, item_id, is_splitwise")
				.order("name");
			if (error) throw safeDbError("Fetch accounts", error);
			const accountIds = (accounts ?? []).map((a) => a.id);
			const { data: cardDetails } = await client.from("credit_card_details").select("account_id, card_id, credit_card_catalog(issuer, name)").in("account_id", accountIds);
			const cardMap: Record<number, { issuer: string; name: string }> = {};
			for (const cd of cardDetails ?? []) {
				const catalog = cd.credit_card_catalog as unknown as { issuer: string; name: string } | null;
				if (catalog) cardMap[cd.account_id] = catalog;
			}
			return text({ count: accounts?.length ?? 0, accounts: (accounts ?? []).map((a) => ({ id: a.id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype, currentBalance: a.current_balance ? Number(a.current_balance) : null, availableBalance: a.available_balance ? Number(a.available_balance) : null, currency: a.iso_currency_code, isSplitwise: a.is_splitwise, card: cardMap[a.id] ?? null })) });
		});

		server.tool("get-user-profile", "Get user's Prospify profile (age, income, credit score).", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data } = await client.from("user_profiles").select("id, age, income, credit_score, created_at").eq("id", userId).maybeSingle();
			if (!data) return text({ profile: null, message: "No profile found." });
			return text({ profile: { age: data.age, income: data.income, creditScore: data.credit_score, createdAt: data.created_at } });
		});

		server.tool("get-linked-accounts", "Get confirmed linked accounts (primary/authorized user relationships).", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data, error } = await client.from("linked_accounts").select("id, primary_account_id, authorized_account_id, primary_user_name, authorized_user_name, status, confirmed_at").eq("status", "confirmed");
			if (error) throw safeDbError("Fetch linked accounts", error);
			return text((data ?? []).map((l) => ({ id: l.id, primaryAccountId: l.primary_account_id, authorizedAccountId: l.authorized_account_id, primaryUserName: l.primary_user_name, authorizedUserName: l.authorized_user_name, confirmedAt: l.confirmed_at })));
		});

		// ── Benefits ──

		server.tool("get-cards-with-benefits", "List cards that have benefit tracking configured.", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: rpcData, error: rpcErr } = await client.rpc("get_user_cards_with_benefits", { p_user_id: userId });
			if (!rpcErr && rpcData) return text(rpcData);
			const { data: accounts } = await client.from("accounts").select("id, mask");
			const accountIds = (accounts ?? []).map((a) => a.id);
			if (accountIds.length === 0) return text([]);
			const { data: cards } = await client.from("credit_card_details").select("account_id, card_id, open_date, credit_card_catalog(id, issuer, name)").in("account_id", accountIds);
			const cardIds = [...new Set((cards ?? []).map((c) => c.card_id))];
			const nowIso = new Date().toISOString();
			const { data: configs } = await client.from("card_benefit_configs").select("card_id").in("card_id", cardIds).lte("effective_from", nowIso).or(`effective_until.is.null,effective_until.gt.${nowIso}`);
			const configCardIds = new Set((configs ?? []).map((c) => c.card_id));
			const maskByAccount = new Map((accounts ?? []).map((a) => [a.id, a.mask]));
			return text((cards ?? []).filter((c) => configCardIds.has(c.card_id)).map((c) => {
				const catalog = c.credit_card_catalog as unknown as { issuer: string; name: string };
				return { accountId: c.account_id, cardId: c.card_id, issuer: catalog?.issuer, name: catalog?.name, mask: maskByAccount.get(c.account_id) ?? null, openDate: c.open_date };
			}));
		});

		server.tool("get-benefit-summary", "YTD value captured for a card.", { accountId: z.number().describe("Account ID") }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data: cd } = await client.from("credit_card_details").select("card_id, credit_card_catalog(issuer, name)").eq("account_id", args.accountId).maybeSingle();
			if (!cd) return text({ card: null, totalValueCaptured: 0 });
			const now = new Date();
			const { data: configs } = await client.from("card_benefit_configs").select("id").eq("card_id", cd.card_id).lte("effective_from", now.toISOString()).or(`effective_until.is.null,effective_until.gt.${now.toISOString()}`);
			const yr = now.getFullYear();
			const { data: usages } = await client.from("benefit_usages").select("amount_used").in("benefit_config_id", (configs ?? []).map((c) => c.id)).gte("period_start", `${yr}-01-01`).lte("period_end", `${yr + 1}-01-01`);
			const total = (usages ?? []).reduce((s, u) => s + Number(u.amount_used), 0);
			const cat = cd.credit_card_catalog as unknown as { issuer: string; name: string };
			return text({ card: { issuer: cat?.issuer, name: cat?.name }, totalValueCaptured: Math.round(total * 100) / 100, viewYear: yr });
		});

		server.tool("get-benefit-details", "Detailed benefit configs and usage for a card at a given frequency.", { accountId: z.number(), frequency: z.enum(["monthly", "quarterly", "semiannual", "annual", "one_time"]) }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data: cd } = await client.from("credit_card_details").select("card_id").eq("account_id", args.accountId).maybeSingle();
			if (!cd) return text([]);
			const now = new Date();
			const { data: configs } = await client.from("card_benefit_configs").select("*").eq("card_id", cd.card_id).eq("frequency", args.frequency).lte("effective_from", now.toISOString()).or(`effective_until.is.null,effective_until.gt.${now.toISOString()}`).order("benefit_name");
			if (!configs?.length) return text([]);
			const { data: usages } = await client.from("benefit_usages").select("benefit_config_id, amount_used").in("benefit_config_id", configs.map((c) => c.id));
			const byConfig = new Map<string, number>();
			for (const u of usages ?? []) byConfig.set(u.benefit_config_id, (byConfig.get(u.benefit_config_id) ?? 0) + Number(u.amount_used));
			return text(configs.map((c) => {
				const used = byConfig.get(c.id) ?? 0;
				const amt = Number(c.amount);
				return { configId: c.id, benefitName: c.benefit_name, benefitKey: c.benefit_key, description: c.description, frequency: c.frequency, amount: amt, totalUsed: Math.round(used * 100) / 100, remaining: Math.max(0, Math.round((amt - used) * 100) / 100), usagePercent: amt > 0 ? Math.min(100, Math.round((used / amt) * 100)) : 0, trackable: c.trackable };
			}));
		});

		server.tool("mark-benefit-used", "Manually mark a benefit as used.", { benefitConfigId: z.string().uuid(), amountUsed: z.number().positive(), note: z.string().max(1000).optional() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: config } = await client.from("card_benefit_configs").select("id, benefit_name, amount").eq("id", args.benefitConfigId).maybeSingle();
			if (!config) throw new Error("Benefit config not found");
			const now = new Date();
			const ps = new Date(now.getFullYear(), now.getMonth(), 1);
			const pe = new Date(now.getFullYear(), now.getMonth() + 1, 0);
			const { error } = await client.from("benefit_usages").insert({ user_id: userId, benefit_config_id: args.benefitConfigId, amount_used: args.amountUsed, period_start: ps.toISOString(), period_end: pe.toISOString(), is_manual: true, note: args.note ?? null });
			if (error) throw safeDbError("Mark benefit", error);
			return text(`Marked $${args.amountUsed} used for "${config.benefit_name}".`);
		});

		server.tool("run-benefit-auto-match", "Auto-match benefits to transactions.", { accountId: z.number() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: cd } = await client.from("credit_card_details").select("card_id").eq("account_id", args.accountId).maybeSingle();
			if (!cd) throw new Error("No card found");
			const now = new Date();
			const { data: configs } = await client.from("card_benefit_configs").select("id, merchant_patterns").eq("card_id", cd.card_id).lte("effective_from", now.toISOString()).or(`effective_until.is.null,effective_until.gt.${now.toISOString()}`).not("merchant_patterns", "is", null);
			if (!configs?.length) return text("No benefit configs with merchant patterns found.");
			const ago = new Date(); ago.setMonth(ago.getMonth() - 6);
			const { data: txs } = await client.from("transactions").select("plaid_transaction_id, name, amount, date").eq("account_id", args.accountId).lt("amount", 0).gte("date", ago.toISOString().slice(0, 10)).eq("is_deleted", false).limit(5000);
			const { data: existing } = await client.from("benefit_usages").select("plaid_transaction_id").in("benefit_config_id", configs.map((c) => c.id)).not("plaid_transaction_id", "is", null);
			const used = new Set((existing ?? []).map((u) => u.plaid_transaction_id));
			let count = 0;
			for (const cfg of configs) {
				const patterns = cfg.merchant_patterns as string[];
				if (!patterns?.length) continue;
				for (const tx of txs ?? []) {
					if (used.has(tx.plaid_transaction_id)) continue;
					if (!patterns.some((p) => (tx.name as string).toLowerCase().includes(p.toLowerCase()))) continue;
					const ps = new Date(now.getFullYear(), now.getMonth(), 1);
					const pe = new Date(now.getFullYear(), now.getMonth() + 1, 0);
					const { error } = await client.from("benefit_usages").insert({ user_id: userId, benefit_config_id: cfg.id, plaid_transaction_id: tx.plaid_transaction_id, amount_used: Math.abs(Number(tx.amount)), period_start: ps.toISOString(), period_end: pe.toISOString(), is_manual: false });
					if (!error) { count++; used.add(tx.plaid_transaction_id); }
				}
			}
			return text(`Auto-match complete: ${count} new match${count !== 1 ? "es" : ""} found.`);
		});

		server.tool("search-transactions-for-linking", "Search credit transactions for benefit linking.", { accountId: z.number(), search: z.string().max(500).default(""), limit: z.number().max(20).default(10) }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data, error } = await client.from("transactions").select("id, plaid_transaction_id, name, amount, date").eq("account_id", args.accountId).lt("amount", 0).eq("is_deleted", false).ilike("name", `%${escapeLikePattern(args.search)}%`).order("date", { ascending: false }).limit(args.limit);
			if (error) throw safeDbError("Search transactions", error);
			return text((data ?? []).map((t) => ({ id: t.id, plaidTransactionId: t.plaid_transaction_id, name: t.name, amount: Math.abs(Number(t.amount)), date: t.date })));
		});

		// ── Subscriptions ──

		server.tool("get-subscriptions", "Detect recurring subscriptions from transaction patterns.", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data, error } = await client.rpc("detect_subscriptions", { p_user_id: userId });
			if (!error && data) return text({ subscriptions: data });
			const { data: txs, error: txErr } = await client.from("transactions").select("name, amount, date, account_id, category, card_name").eq("is_deleted", false).gt("amount", 0).order("date", { ascending: false }).limit(2000);
			if (txErr) throw safeDbError("Fetch transactions", txErr);
			if (!txs?.length) return text({ subscriptions: [] });
			// Simplified subscription detection
			type MerchantGroup = { name: string; amounts: number[]; dates: string[]; accountId: number; cardName: string | null; category: string | null };
			const groups = new Map<string, MerchantGroup>();
			for (const tx of txs) { const k = `${tx.name.toLowerCase()}|${tx.account_id}`; const g: MerchantGroup = groups.get(k) ?? { name: tx.name, amounts: [] as number[], dates: [] as string[], accountId: tx.account_id as number, cardName: tx.card_name as string | null, category: tx.category as string | null }; g.amounts.push(Number(tx.amount)); g.dates.push(tx.date as string); groups.set(k, g); }
			const subs = [];
			for (const [, g] of groups) {
				if (g.amounts.length < 3) continue;
				const avg = g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length;
				const cv = Math.sqrt(g.amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / g.amounts.length) / avg;
				if (cv > 0.2) continue;
				const sorted = g.dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
				const intervals = []; for (let i = 1; i < sorted.length; i++) intervals.push((sorted[i] - sorted[i - 1]) / 86400000);
				if (intervals.length < 2) continue;
				intervals.sort((a, b) => a - b);
				const med = intervals[Math.floor(intervals.length / 2)];
				let cadence: string | null = null;
				if (med >= 27 && med <= 35) cadence = "monthly"; else if (med >= 85 && med <= 100) cadence = "quarterly"; else if (med >= 350 && med <= 380) cadence = "annual"; else if (med >= 6 && med <= 8) cadence = "weekly";
				if (!cadence) continue;
				subs.push({ merchantName: g.name, cardName: g.cardName, accountId: g.accountId, cadence, averageAmount: Math.round(avg * 100) / 100, transactionCount: g.amounts.length, lastSeen: g.dates[0], isActive: (Date.now() - new Date(sorted[sorted.length - 1]).getTime()) / 86400000 <= med * 1.5, category: g.category, confidence: Math.round((1 - cv) * 100) });
			}
			subs.sort((a, b) => a.isActive !== b.isActive ? (a.isActive ? -1 : 1) : b.averageAmount - a.averageAmount);
			return text({ subscriptions: subs });
		});

		server.tool("dismiss-subscription", "Dismiss a false-positive subscription.", { merchantKey: z.string().max(500), accountId: z.number() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { error } = await client.from("subscription_dismissals").insert({ user_id: userId, merchant_key: args.merchantKey, account_id: args.accountId });
			if (error) throw safeDbError("Dismiss subscription", error);
			return text(`Subscription "${args.merchantKey}" dismissed.`);
		});

		server.tool("restore-subscription", "Restore a dismissed subscription.", { merchantKey: z.string().max(500), accountId: z.number() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { error } = await client.from("subscription_dismissals").delete().eq("merchant_key", args.merchantKey).eq("account_id", args.accountId);
			if (error) throw safeDbError("Restore subscription", error);
			return text(`Subscription "${args.merchantKey}" restored.`);
		});

		// ── Credits ──

		server.tool("get-credit-matches", "Pending credit-to-charge match suggestions.", { limit: z.number().max(50).default(20) }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data, error } = await client.from("credit_match_suggestions").select("id, credit_plaid_transaction_id, charge_plaid_transaction_id, confidence_score, credit_type, status").eq("status", "pending").order("confidence_score", { ascending: false }).limit(args.limit);
			if (error) throw safeDbError("Fetch matches", error);
			if (!data?.length) return text({ matches: [] });
			const allIds = [...new Set([...data.map((d) => d.credit_plaid_transaction_id), ...data.map((d) => d.charge_plaid_transaction_id)])];
			const { data: txs } = await client.from("transactions").select("plaid_transaction_id, name, amount, date, card_name").in("plaid_transaction_id", allIds);
			const txMap = new Map((txs ?? []).map((t) => [t.plaid_transaction_id, t]));
			return text({ matches: data.map((m) => { const cr = txMap.get(m.credit_plaid_transaction_id); const ch = txMap.get(m.charge_plaid_transaction_id); return { suggestionId: m.id, confidence: m.confidence_score, creditType: m.credit_type, credit: cr ? { name: cr.name, amount: Math.abs(Number(cr.amount)), date: cr.date, cardName: cr.card_name } : null, charge: ch ? { name: ch.name, amount: Number(ch.amount), date: ch.date, cardName: ch.card_name } : null }; }) });
		});

		server.tool("confirm-credit-match", "Confirm a credit-to-charge match.", { suggestionId: z.string().max(200) }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: s } = await client.from("credit_match_suggestions").select("id, credit_plaid_transaction_id, charge_plaid_transaction_id").eq("id", args.suggestionId).eq("status", "pending").maybeSingle();
			if (!s) throw new Error("Match not found or already processed");
			const { data: cr } = await client.from("transactions").select("amount").eq("plaid_transaction_id", s.credit_plaid_transaction_id).maybeSingle();
			await client.from("transaction_credits").insert({ user_id: userId, plaid_transaction_id: s.charge_plaid_transaction_id, credit_plaid_transaction_id: s.credit_plaid_transaction_id, credit_amount: Math.abs(Number(cr?.amount ?? 0)) });
			await client.from("credit_match_suggestions").update({ status: "confirmed" }).eq("id", args.suggestionId);
			return text("Match confirmed.");
		});

		server.tool("reject-credit-match", "Reject a match suggestion.", { suggestionId: z.string().max(200) }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			await client.from("credit_match_suggestions").update({ status: "rejected" }).eq("id", args.suggestionId).eq("status", "pending");
			return text("Match rejected.");
		});

		server.tool("get-available-credits", "Credit transactions available for linking.", { accountId: z.number().optional(), search: z.string().max(500).optional() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			let q = client.from("transactions").select("id, plaid_transaction_id, name, amount, date, account_id, card_name").lt("amount", 0).eq("is_deleted", false).order("date", { ascending: false }).limit(50);
			if (args.accountId) q = q.eq("account_id", args.accountId);
			if (args.search) q = q.ilike("name", `%${escapeLikePattern(args.search)}%`);
			const { data, error } = await q;
			if (error) throw safeDbError("Fetch credits", error);
			return text((data ?? []).map((t) => ({ id: t.id, plaidTransactionId: t.plaid_transaction_id, name: t.name, amount: Math.abs(Number(t.amount)), date: t.date, accountId: t.account_id, cardName: t.card_name })));
		});

		server.tool("link-credit", "Link a credit to a charge.", { chargeTransactionId: z.number(), creditTransactionId: z.number(), creditAmount: z.number().positive(), note: z.string().max(1000).optional() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: ch } = await client.from("transactions").select("plaid_transaction_id").eq("id", args.chargeTransactionId).maybeSingle();
			const { data: cr } = await client.from("transactions").select("plaid_transaction_id, amount").eq("id", args.creditTransactionId).maybeSingle();
			if (!ch || !cr) throw new Error("Transaction not found");
			if (Number(cr.amount) >= 0) throw new Error("Credit must have negative amount");
			const { error } = await client.from("transaction_credits").insert({ user_id: userId, plaid_transaction_id: ch.plaid_transaction_id, credit_plaid_transaction_id: cr.plaid_transaction_id, credit_amount: args.creditAmount, note: args.note ?? null });
			if (error) throw safeDbError("Link credit", error);
			return text("Credit linked.");
		});

		// ── Mutations ──

		server.tool("edit-transaction", "Edit a transaction's display name, amount, or date.", { transactionId: z.number(), name: z.string().max(500).optional(), amount: z.number().positive().optional(), date: z.string().max(10).optional() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: tx } = await client.from("transactions").select("id, plaid_transaction_id, name, amount, date, account_id").eq("id", args.transactionId).maybeSingle();
			if (!tx) throw new Error("Transaction not found");
			const od: Record<string, unknown> = { plaid_transaction_id: tx.plaid_transaction_id, user_id: userId, original_name: tx.name, original_amount: Number(tx.amount), original_date: tx.date, original_account_id: tx.account_id, updated_at: new Date().toISOString() };
			if (args.name) od.edited_name = args.name;
			if (args.amount) od.edited_amount = args.amount;
			if (args.date) od.edited_date = args.date;
			const { error } = await client.from("transaction_overrides").upsert(od, { onConflict: "plaid_transaction_id" });
			if (error) throw safeDbError("Edit transaction", error);
			return text(`Transaction ${args.transactionId} updated.`);
		});

		server.tool("delete-transaction", "Soft-delete a transaction.", { transactionId: z.number() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: tx } = await client.from("transactions").select("plaid_transaction_id, name, amount, date, account_id").eq("id", args.transactionId).maybeSingle();
			if (!tx) throw new Error("Transaction not found");
			const { error } = await client.from("transaction_overrides").upsert({ plaid_transaction_id: tx.plaid_transaction_id, user_id: userId, is_deleted: true, original_name: tx.name, original_amount: Number(tx.amount), original_date: tx.date, original_account_id: tx.account_id, updated_at: new Date().toISOString() }, { onConflict: "plaid_transaction_id" });
			if (error) throw safeDbError("Delete transaction", error);
			return text(`Transaction "${tx.name}" deleted.`);
		});

		server.tool("restore-transaction", "Restore a deleted transaction.", { transactionId: z.number() }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data: tx } = await client.from("transactions").select("plaid_transaction_id").eq("id", args.transactionId).maybeSingle();
			if (!tx) throw new Error("Transaction not found");
			await client.from("transaction_overrides").delete().eq("plaid_transaction_id", tx.plaid_transaction_id);
			return text(`Transaction ${args.transactionId} restored.`);
		});

		server.tool("change-category", "Change a transaction's category.", { transactionId: z.number(), newCategory: z.string().max(100).regex(/^[A-Z][A-Z0-9_]*$/), applyToAll: z.boolean().default(false) }, async (args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const userId = extra.authInfo!.extra?.userId as string;
			const { data: tx } = await client.from("transactions").select("id, name, account_id").eq("id", args.transactionId).maybeSingle();
			if (!tx) throw new Error("Transaction not found");
			await client.from("transactions_table").update({ category: args.newCategory, updated_at: new Date().toISOString() }).eq("id", tx.id).eq("account_id", tx.account_id);
			if (args.applyToAll) await client.from("category_rules").upsert({ user_id: userId, merchant_name: tx.name, category: args.newCategory, updated_at: new Date().toISOString() }, { onConflict: "user_id,merchant_name" });
			return text(`Category changed to ${args.newCategory}${args.applyToAll ? " (applied to all)" : ""}.`);
		});

		// ── Splitwise ──

		server.tool("get-splitwise-status", "Check Splitwise connection.", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data } = await client.from("splitwise_connections").select("splitwise_user_id").maybeSingle();
			return text({ connected: !!data, splitwiseUserId: data?.splitwise_user_id ? Number(data.splitwise_user_id) : null });
		});

		server.tool("get-splitwise-friends", "List Splitwise friends.", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data } = await client.from("splitwise_friends").select("id, first_name, last_name, email").order("first_name");
			return text((data ?? []).map((f) => ({ id: Number(f.id), firstName: f.first_name, lastName: f.last_name, email: f.email })));
		});

		server.tool("get-splitwise-groups", "List Splitwise groups with members.", {}, async (_args, extra) => {
			const client = createUserClient(extra.authInfo!.token);
			const { data: groups } = await client.from("splitwise_groups").select("id, name, splitwise_group_id").order("name");
			const gids = (groups ?? []).map((g) => g.id);
			const { data: members } = await client.from("splitwise_group_members").select("group_id, friend_id").in("group_id", gids);
			const fids = [...new Set((members ?? []).map((m) => Number(m.friend_id)))];
			const { data: friends } = await client.from("splitwise_friends").select("id, first_name, last_name, email").in("id", fids);
			const fMap = new Map((friends ?? []).map((f) => [Number(f.id), f]));
			const mByG = new Map<string, typeof friends>();
			for (const m of members ?? []) { const l = mByG.get(m.group_id) ?? []; const f = fMap.get(Number(m.friend_id)); if (f) l.push(f); mByG.set(m.group_id, l); }
			return text((groups ?? []).map((g) => ({ id: Number(g.id), name: g.name, splitwiseGroupId: Number(g.splitwise_group_id), members: (mByG.get(g.id) ?? []).map((f) => ({ id: Number(f.id), firstName: f.first_name, lastName: f.last_name, email: f.email })) })));
		});
	},
	{},
	{ basePath: "/api", maxDuration: 30 },
);

// ── Auth ──

const verifyToken = async (
	_req: Request,
	bearerToken?: string,
): Promise<AuthInfo | undefined> => {
	if (!bearerToken) return undefined;
	try {
		const { payload } = await jwtVerify(bearerToken, getJwks(), {
			issuer: `${SUPABASE_URL}/auth/v1`,
			audience: "authenticated",
		});
		if (!payload.sub) return undefined;
		const clientId = (payload as Record<string, unknown>).client_id as string | undefined;
		if (!clientId) return undefined;
		const scopeClaim = (payload as Record<string, unknown>).scope;
		const scopes = typeof scopeClaim === "string" ? scopeClaim.split(" ").filter(Boolean) : [];
		return {
			token: bearerToken,
			clientId,
			scopes,
			extra: { userId: payload.sub, email: payload.email },
		};
	} catch (e) {
		console.error("[verifyToken] JWT verification failed:", (e as Error).message);
		return undefined;
	}
};

const authHandler = withMcpAuth(handler, verifyToken, {
	required: true,
	resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
