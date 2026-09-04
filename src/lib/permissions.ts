import { createUserSupabaseClient } from "../supabase-client";

export interface WriteAccessContext {
	accessToken: string;
	userId: string;
	clientId: string;
}

/** Pure decision helper kept separate so permission behavior is easy to test. */
export function isWriteAllowed(permission: { write_allowed?: boolean } | null): boolean {
	return permission?.write_allowed === true;
}

type PermissionLookup = (
	context: WriteAccessContext,
) => Promise<{ write_allowed?: boolean } | null>;

async function lookupWritePermission(
	context: WriteAccessContext,
): Promise<{ write_allowed?: boolean } | null> {
	const client = createUserSupabaseClient(context.accessToken);
	const { data, error } = await client
		.from("mcp_oauth_permissions")
		.select("write_allowed")
		.eq("user_id", context.userId)
		.eq("client_id", context.clientId)
		.maybeSingle();

	if (error) {
		console.error("[mcp/permissions] Permission lookup failed", error);
		throw new Error("Write permission could not be verified; the operation was blocked.");
	}

	return data;
}

/**
 * Require an explicit read-write OAuth grant. Missing records and lookup
 * errors fail closed, so a read-only token can never reach a mutation.
 */
export async function requireWriteAccess(
	context: WriteAccessContext,
	lookup: PermissionLookup = lookupWritePermission,
): Promise<void> {
	if (!isWriteAllowed(await lookup(context))) {
		throw new Error("This operation requires an OAuth read-and-write grant.");
	}
}
