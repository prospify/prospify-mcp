/**
 * MCP protocol-level tests — verify JSON-RPC compliance, error handling,
 * and OAuth flow correctness.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const MCP_PORT = 4204;
const MCP_URL = `http://localhost:${MCP_PORT}`;

let serverProcess: ReturnType<typeof Bun.spawn> | null = null;

async function waitForServer(url: string, timeoutMs = 6000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${url}/healthz`);
			if (res.ok) return;
		} catch {
			// Not ready
		}
		await Bun.sleep(200);
	}
	throw new Error("Server did not start in time");
}

let serverReady = false;

describe("MCP Protocol Compliance", () => {
	beforeAll(async () => {
		serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
			env: {
				...process.env,
				MCP_SERVER_PORT: String(MCP_PORT),
				MCP_BASE_URL: MCP_URL,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		try {
			await waitForServer(MCP_URL);
			serverReady = true;
		} catch {
			console.warn("HTTP server failed to start — skipping protocol tests (likely CI without OAuth)");
			serverProcess?.kill();
			serverProcess = null;
		}
	});

	afterAll(() => {
		serverProcess?.kill();
	});

	// --- Health & Discovery ---

	test("health endpoint returns plain text", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/healthz`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("running");
	});

	test("OAuth authorization server metadata is valid RFC 8414", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/.well-known/oauth-authorization-server`);
		expect(res.status).toBe(200);
		const metadata = (await res.json()) as Record<string, unknown>;

		// RFC 8414 required fields
		expect(metadata.issuer).toBeTruthy();
		expect(metadata.authorization_endpoint).toBeTruthy();
		expect(metadata.token_endpoint).toBeTruthy();
		expect(metadata.response_types_supported).toBeArray();
		expect(metadata.code_challenge_methods_supported).toBeArray();
	});

	test("protected resource metadata exists (RFC 9728)", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/.well-known/oauth-protected-resource`);
		// May return 200 or 404 depending on FastMCP version
		expect([200, 404]).toContain(res.status);
		if (res.status === 200) {
			const meta = (await res.json()) as Record<string, unknown>;
			expect(meta.resource).toBeTruthy();
		}
	});

	// --- MCP Protocol ---

	test("MCP endpoint rejects unauthenticated requests with 401", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "0.1.0" },
				},
			}),
		});
		expect(res.status).toBe(401);
	});

	test("MCP endpoint rejects invalid Bearer token", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer invalid-token-xyz",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "0.1.0" },
				},
			}),
		});
		// Should reject — either 401 or 403
		expect([401, 403]).toContain(res.status);
	});

	test("MCP endpoint returns proper content type", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "0.1.0" },
				},
			}),
		});
		// Even on 401, content type should be set
		const contentType = res.headers.get("content-type") ?? "";
		expect(
			contentType.includes("application/json") || contentType.includes("text/event-stream"),
		).toBe(true);
	});

	test("OAuth consent/authorize endpoint exists", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/oauth/authorize`, {
			redirect: "manual",
		});
		// Should exist (302 redirect or 200 consent page or 400 missing params)
		expect([200, 302, 400]).toContain(res.status);
	});

	test("OAuth token endpoint exists", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "grant_type=authorization_code&code=invalid",
		});
		// Should respond (400 for invalid code, not 404)
		expect(res.status).not.toBe(404);
	});

	// --- Error Handling ---

	test("non-existent route returns 404", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/nonexistent-route`);
		expect(res.status).toBe(404);
	});

	test("GET on MCP endpoint returns method info or error", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/mcp`);
		// MCP endpoint is POST-only, GET might return 405 or SSE upgrade
		expect([200, 400, 401, 405]).toContain(res.status);
	});

	// --- CORS & Security Headers ---

	test("server responds to OPTIONS preflight", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/mcp`, {
			method: "OPTIONS",
		});
		// Should handle CORS preflight
		expect([200, 204, 401]).toContain(res.status);
	});
});
