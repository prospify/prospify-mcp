/**
 * Unit tests for the JWT-based authenticate callback.
 *
 * These tests exercise the failure paths that don't require a live
 * network call to Supabase JWKS — missing tokens, malformed headers,
 * and unverifiable JWTs. End-to-end verification with a real signed
 * token lives in tests/integration/auth.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { authenticate } from "../../src/auth";

function req(headers: Record<string, string | undefined>) {
	return { headers } as { headers: Record<string, string | string[] | undefined> };
}

async function expectUnauthorized(
	promise: Promise<unknown>,
	matcher?: (body: Record<string, unknown>) => void,
) {
	try {
		await promise;
		throw new Error("expected unauthorized Response");
	} catch (e) {
		if (!(e instanceof Response)) throw e;
		expect(e.status).toBe(401);
		const wwwAuth = e.headers.get("WWW-Authenticate") ?? "";
		expect(wwwAuth).toContain("Bearer");
		expect(wwwAuth).toContain("resource_metadata");
		if (matcher) {
			const body = (await e.json()) as Record<string, unknown>;
			matcher(body);
		}
	}
}

describe("authenticate", () => {
	test("rejects requests with no Authorization header", async () => {
		await expectUnauthorized(authenticate(req({})), (body) => {
			expect(body.error).toBe("invalid_token");
			expect(String(body.error_description)).toMatch(/bearer/i);
		});
	});

	test("rejects empty bearer tokens", async () => {
		await expectUnauthorized(
			authenticate(req({ authorization: "Bearer " })),
			(body) => {
				expect(body.error).toBe("invalid_token");
			},
		);
	});

	test("rejects malformed JWT payloads", async () => {
		await expectUnauthorized(
			authenticate(req({ authorization: "Bearer not-a-jwt" })),
			(body) => {
				expect(body.error).toBe("invalid_token");
			},
		);
	});
});
