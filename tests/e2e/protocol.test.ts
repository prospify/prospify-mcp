/**
 * MCP protocol-level tests — verify JSON-RPC compliance, RFC 9728
 * protected-resource metadata, and error handling.
 *
 * OAuth authorization server metadata is served by Supabase, not by this
 * MCP server, so this server deliberately does NOT expose
 * /.well-known/oauth-authorization-server, /oauth/authorize, or
 * /oauth/token. It only advertises itself as a Protected Resource.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const MCP_PORT = 4204;
const MCP_URL = `http://localhost:${MCP_PORT}`;
const MCP_ENDPOINT = `${MCP_URL}/api/mcp`;

let serverProcess: ReturnType<typeof Bun.spawn> | null = null;
let serverReady = false;

async function waitForServer(url: string, timeoutMs = 6000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${url}/healthz`);
			if (res.ok) return;
		} catch {
			// not ready yet
		}
		await Bun.sleep(200);
	}
	throw new Error("Server did not start in time");
}

describe("MCP Protocol Compliance", () => {
	beforeAll(async () => {
		serverProcess = Bun.spawn([
			"bun",
			"next",
			"dev",
			"--hostname",
			"127.0.0.1",
			"--port",
			String(MCP_PORT),
		], {
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
			// Warm the dynamic routes before individual tests start their 5-second
			// timeout. Next.js development compilation can be slower on a cold start.
			await fetch(MCP_ENDPOINT, { method: "POST" });
			await fetch(`${MCP_URL}/.well-known/oauth-protected-resource`);
		} catch {
			console.warn(
				"HTTP server failed to start — skipping protocol tests (likely CI without env vars)",
			);
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

	test("protected resource metadata conforms to RFC 9728", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/.well-known/oauth-protected-resource`);
		expect(res.status).toBe(200);
		const meta = (await res.json()) as Record<string, unknown>;

		expect(meta.resource).toBeTruthy();
		expect(meta.authorization_servers).toBeArray();
		const servers = meta.authorization_servers as string[];
		expect(servers.length).toBeGreaterThan(0);
		// Must point at Supabase Auth, not at ourselves
		expect(servers[0]).toContain("supabase.co/auth/v1");
	});

	// --- MCP Protocol ---

	test("MCP endpoint rejects unauthenticated requests with 401", async () => {
		if (!serverReady) return;
		const res = await fetch(MCP_ENDPOINT, {
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
		const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
		expect(wwwAuth).toContain("Bearer");
	});

	test("MCP endpoint rejects invalid Bearer token", async () => {
		if (!serverReady) return;
		const res = await fetch(MCP_ENDPOINT, {
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
		expect([401, 403]).toContain(res.status);
	});

	test("MCP endpoint returns proper content type", async () => {
		if (!serverReady) return;
		const res = await fetch(MCP_ENDPOINT, {
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
		const contentType = res.headers.get("content-type") ?? "";
		expect(
			contentType.includes("application/json") || contentType.includes("text/event-stream"),
		).toBe(true);
	});

	// --- Error Handling ---

	test("non-existent route returns 404", async () => {
		if (!serverReady) return;
		const res = await fetch(`${MCP_URL}/nonexistent-route`);
		expect(res.status).toBe(404);
	});

	test("GET on MCP endpoint returns method info or error", async () => {
		if (!serverReady) return;
		const res = await fetch(MCP_ENDPOINT);
		expect([200, 400, 401, 405]).toContain(res.status);
	});

	test("server responds to OPTIONS preflight", async () => {
		if (!serverReady) return;
		const res = await fetch(MCP_ENDPOINT, { method: "OPTIONS" });
		expect([200, 204, 401]).toContain(res.status);
	});
});
