/**
 * Shared utilities.
 */

/**
 * Escape LIKE/ILIKE wildcard characters (% and _) in a search string.
 * Prevents pattern injection in Supabase .ilike() queries.
 */
export function escapeLikePattern(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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
