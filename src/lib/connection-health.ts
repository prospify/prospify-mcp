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
			client
				.from("splitwise_connections")
				.select("splitwise_user_id, updated_at")
				.maybeSingle(),
		]);

	if (itemsError) throw safeDbError("Fetch connection health", itemsError);
	if (splitwiseError) throw safeDbError("Fetch Splitwise connection health", splitwiseError);

	const plaidItems = (items ?? []) as unknown as PlaidItem[];
	const splitwiseConnection = splitwise as unknown as SplitwiseConnection | null;
	const needsAttention = plaidItems.filter((item) => item.status !== "good");
	const splitwiseConnected = splitwiseConnection !== null;

	return {
		checkedAt: new Date().toISOString(),
		overallStatus:
			plaidItems.length === 0 && !splitwiseConnected
				? "not_connected"
				: needsAttention.length > 0
					? "needs_attention"
					: "healthy",
		plaid: {
			connected: plaidItems.length > 0,
			connectedItems: plaidItems.length,
			needsAttentionItems: needsAttention.length,
			items: plaidItems.map((item) => ({
				id: item.id,
				institutionId: item.plaid_institution_id,
				status: item.status,
				createdAt: item.created_at,
				updatedAt: item.updated_at,
				lastTransactionRefresh: item.last_transaction_refresh,
				lastSuccessfulSync: item.last_successful_sync,
			})),
		},
		splitwise: {
			connected: splitwiseConnected,
			updatedAt: splitwiseConnection?.updated_at ?? null,
			splitwiseUserId: splitwiseConnection?.splitwise_user_id
				? Number(splitwiseConnection.splitwise_user_id)
				: null,
		},
	};
}
