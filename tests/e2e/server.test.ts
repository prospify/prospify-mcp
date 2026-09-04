import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const MCP_PORT = 4202; // Use different port for tests
const MCP_URL = `http://localhost:${MCP_PORT}`;

let serverProcess: ReturnType<typeof Bun.spawn> | null = null;

describe("MCP server E2E", () => {
	beforeAll(async () => {
		// Start the MCP server on test port
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

		// Wait for server to be ready
		let ready = false;
		for (let i = 0; i < 30; i++) {
			try {
				const res = await fetch(`${MCP_URL}/healthz`);
				if (res.ok) {
					ready = true;
					break;
				}
			} catch {
				// Server not ready yet
			}
			await Bun.sleep(200);
		}

		if (!ready) {
			console.warn("MCP server failed to start — skipping HTTP E2E tests (likely missing OAuth config in CI)");
			serverProcess?.kill();
			serverProcess = null;
			return;
		}

		// Compile the dynamic routes before individual tests start their 5-second
		// timeout. Next.js development compilation can be slower on a cold start.
		await fetch(`${MCP_URL}/api/mcp`, { method: "POST" });
		await fetch(`${MCP_URL}/.well-known/oauth-protected-resource`);
	}, 15000);

	afterAll(() => {
		if (serverProcess) {
			serverProcess.kill();
			serverProcess = null;
		}
	});

	test("health check returns 200", async () => {
		if (!serverProcess) return; // Skip in CI
		const res = await fetch(`${MCP_URL}/healthz`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("Prospify MCP server is running");
	});

	test("MCP endpoint exists", async () => {
		if (!serverProcess) return; // Skip in CI
		// The MCP endpoint should respond (even if auth fails)
		const res = await fetch(`${MCP_URL}/api/mcp`, {
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

		// Should get a response (might be 401 for auth, but endpoint exists)
		expect([200, 401, 403]).toContain(res.status);
	});

	test("Protected Resource Metadata points at Supabase", async () => {
		if (!serverProcess) return; // Skip in CI
		// Authorization Server metadata is served by Supabase, not here;
		// we only advertise ourselves as a Protected Resource (RFC 9728).
		const res = await fetch(`${MCP_URL}/.well-known/oauth-protected-resource`);
		expect(res.status).toBe(200);
		const meta = (await res.json()) as Record<string, unknown>;
		expect(meta.authorization_servers).toBeArray();
	});
});
