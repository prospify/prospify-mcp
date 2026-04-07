/**
 * Shared utilities.
 */

import { supabase } from "./db.js";

/**
 * Escape LIKE/ILIKE wildcard characters (% and _) in a search string.
 * Prevents pattern injection in Supabase .ilike() queries.
 */
export function escapeLikePattern(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Verify that an account belongs to the authenticated user.
 * Checks via accounts view which has user_id from the items_table join.
 * Throws if the account doesn't belong to the user.
 */
export async function verifyAccountOwnership(accountId: number, userId: string): Promise<void> {
	const { data } = await supabase
		.from("accounts")
		.select("id")
		.eq("id", accountId)
		.eq("user_id", userId)
		.single();

	if (!data) {
		throw new Error("Account not found or access denied");
	}
}

/**
 * Sanitize a Supabase error for client exposure.
 * Logs the full error internally, returns a generic message to the client.
 */
export function safeDbError(operation: string, error: { message: string; code?: string }): Error {
	// Log full error for debugging (stderr won't go to MCP client)
	console.error(`[${operation}] DB error:`, error.message, error.code ?? "");
	return new Error(`${operation} failed. Please try again.`);
}
