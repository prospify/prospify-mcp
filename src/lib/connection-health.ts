import { createUserSupabaseClient } from "../supabase-client";
import { safeDbError } from "../utils";

type PlaidItem = {
	id: number;
	plaid_institution_id: string;
	status: string;
	created_at: string | null;
	updated_at: string | null;
	last_transaction_refresh: string | null;
	last_successful_sync: string | null;
};

type SplitwiseConnection = {
	splitwise_user_id: number | string | null;
	updated_at: string | null;
};

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function isStale(timestamp: string | null, nowMs: number): boolean {
	if (!timestamp) return true;
	const parsed = Date.parse(timestamp);
	return !Number.isFinite(parsed) || nowMs - parsed > STALE_AFTER_MS;
}

/**
 * Read connection state using the caller's JWT. The items view deliberately
 * omits deleted items; no credentials or provider tokens are selected.
 */
export async function getConnectionHealth(accessToken: string) {
	const client = createUserSupabaseClient(accessToken);

	const [{ data: items, error: itemsError }, { data: splitwise, error: splitwiseError }] =
		await Promise.all([
			client
				.from("items")
				.select(
					"id, plaid_institution_id, status, created_at, updated_at, last_transaction_refresh, last_successful_sync",
				),
			client.from("splitwise_connections").select("splitwise_user_id, updated_at").maybeSingle(),
		]);

	if (itemsError) throw safeDbError("Fetch connection health", itemsError);
	if (splitwiseError) throw safeDbError("Fetch Splitwise connection health", splitwiseError);

	const plaidItems = (items ?? []) as unknown as PlaidItem[];
	const splitwiseConnection = splitwise as unknown as SplitwiseConnection | null;
	const nowMs = Date.now();
	const itemsWithHealth = plaidItems.map((item) => {
		const timestamps = [item.last_successful_sync, item.last_transaction_refresh]
			.filter((timestamp): timestamp is string => Boolean(timestamp))
			.map((timestamp) => Date.parse(timestamp))
			.filter(Number.isFinite);
		const lastActivity = timestamps.length > 0 ? Math.max(...timestamps) : null;
		const stale = lastActivity === null || nowMs - lastActivity > STALE_AFTER_MS;
		return { item, stale };
	});
	const needsAttention = itemsWithHealth.filter(
		({ item, stale }) => item.status !== "good" || stale,
	);
	const splitwiseConnected = splitwiseConnection !== null;
	const splitwiseStale = splitwiseConnected
		? isStale(splitwiseConnection?.updated_at ?? null, nowMs)
		: false;

	return {
		checkedAt: new Date().toISOString(),
		overallStatus:
			plaidItems.length === 0 && !splitwiseConnected
				? "not_connected"
				: needsAttention.length > 0 || splitwiseStale
					? "needs_attention"
					: "healthy",
		plaid: {
			connected: plaidItems.length > 0,
			connectedItems: plaidItems.length,
			needsAttentionItems: needsAttention.length,
			staleItems: itemsWithHealth.filter(({ stale }) => stale).length,
			items: itemsWithHealth.map(({ item, stale }) => ({
				id: item.id,
				institutionId: item.plaid_institution_id,
				status: item.status,
				createdAt: item.created_at,
				updatedAt: item.updated_at,
				lastTransactionRefresh: item.last_transaction_refresh,
				lastSuccessfulSync: item.last_successful_sync,
				stale,
			})),
		},
		splitwise: {
			connected: splitwiseConnected,
			updatedAt: splitwiseConnection?.updated_at ?? null,
			stale: splitwiseStale,
			splitwiseUserId: splitwiseConnection?.splitwise_user_id
				? Number(splitwiseConnection.splitwise_user_id)
				: null,
		},
	};
}
