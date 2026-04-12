/**
 * JWT verification: Supabase OAuth 2.1 → ProspifySession.
 *
 * The MCP server is a pure OAuth Protected Resource. Every request arrives
 * with `Authorization: Bearer <jwt>` where the JWT was minted by Supabase's
 * built-in OAuth server (https://<project>.supabase.co/auth/v1/oauth/token)
 * after the user completed PKCE + consent at prospify.app/oauth/consent.
 *
 * This module:
 *   1. Verifies the JWT signature against Supabase's JWKS (ES256, cached)
 *   2. Validates issuer, audience, and expiry
 *   3. Requires a `client_id` claim (proves OAuth-issued, not password-grant)
 *   4. Optionally enforces an allowlist of registered client IDs
 *   5. Returns a `ProspifySession` that tool handlers use to build a
 *      user-scoped Supabase client (see ./supabase-client.ts)
 *
 * On any failure we throw a `Response` with status 401 and an
 * RFC 9728-compliant `WWW-Authenticate` header so MCP clients can
 * auto-discover the protected-resource metadata and start the OAuth flow.
 */

import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "./env.js";

// Lazy so the module is importable under SKIP_ENV_VALIDATION=true
// (CI unit tests, lint) where SUPABASE_URL is empty and constructing
// `new URL("/auth/v1/.well-known/jwks.json")` would throw.
type Jwks = ReturnType<typeof createRemoteJWKSet>;
let jwksSingleton: Jwks | null = null;
function getJwks(): Jwks {
	if (!jwksSingleton) {
		jwksSingleton = createRemoteJWKSet(
			new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
		);
	}
	return jwksSingleton;
}

const AUDIENCE = "authenticated";
const PRM_URL = `${env.MCP_BASE_URL}/.well-known/oauth-protected-resource`;

export interface ProspifySession extends Record<string, unknown> {
	userId: string;
	email?: string;
	accessToken: string;
	clientId: string;
	scopes: string[];
}

function unauthorized(error: string, description: string): never {
	throw new Response(
		JSON.stringify({ error, error_description: description }),
		{
			status: 401,
			headers: {
				"Content-Type": "application/json",
				"WWW-Authenticate": `Bearer resource_metadata="${PRM_URL}", error="${error}", error_description="${description}"`,
			},
		},
	);
}

function extractBearerToken(
	headers: Record<string, string | string[] | undefined> | undefined,
): string {
	const raw = headers?.authorization;
	const value = typeof raw === "string" ? raw : raw?.[0] ?? "";
	const token = value.replace(/^Bearer\s+/i, "").trim();
	if (!token) unauthorized("invalid_token", "Missing bearer token");
	return token;
}

/**
 * FastMCP `authenticate` callback. Called once per incoming HTTP request;
 * the returned session is made available to every tool handler via
 * `context.session`.
 */
export async function authenticate(
	request?: { headers?: Record<string, string | string[] | undefined> },
): Promise<ProspifySession> {
	const token = extractBearerToken(request?.headers);

	let payload: JWTPayload;
	try {
		const verified = await jwtVerify(token, getJwks(), {
			issuer: `${env.SUPABASE_URL}/auth/v1`,
			audience: AUDIENCE,
		});
		payload = verified.payload;
	} catch (e) {
		if (e instanceof Response) throw e;
		unauthorized("invalid_token", (e as Error).message);
	}

	if (!payload.sub) {
		unauthorized("invalid_token", "token missing sub");
	}

	// Require client_id — proves the token came through the OAuth flow
	// (not a stray password-grant JWT that happened to hit us). This is
	// the MCP spec's "strict resource binding" in spirit.
	const clientId = (payload as Record<string, unknown>).client_id as string | undefined;
	if (!clientId) {
		unauthorized(
			"invalid_token",
			"token is not OAuth-issued (missing client_id claim)",
		);
	}

	// Optional allowlist — empty means accept any OAuth-issued client,
	// which is what we want for Dynamic Client Registration support.
	if (
		env.MCP_ALLOWED_CLIENT_IDS.length > 0 &&
		!env.MCP_ALLOWED_CLIENT_IDS.includes(clientId)
	) {
		unauthorized("invalid_token", "client_id not in allowlist");
	}

	const scopeClaim = (payload as Record<string, unknown>).scope;
	const scopes =
		typeof scopeClaim === "string" ? scopeClaim.split(" ").filter(Boolean) : [];

	return {
		userId: payload.sub as string,
		email: payload.email as string | undefined,
		accessToken: token,
		clientId,
		scopes,
	};
}
