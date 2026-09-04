/**
 * Validate the supported Next.js MCP server locally.
 *
 * Usage:
 *   bun run scripts/validate-mcp.ts
 */

const MCP_PORT = 4203;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}`;
const MCP_ENDPOINT = `${MCP_URL}/api/mcp`;

async function waitForServer() {
	for (let i = 0; i < 60; i++) {
		try {
			const response = await fetch(`${MCP_URL}/healthz`);
			if (response.ok) return;
		} catch {
			// Next.js is still starting.
		}
		await Bun.sleep(250);
	}
	throw new Error(`Server did not start within 15 seconds on port ${MCP_PORT}`);
}

async function main() {
	console.log("=== Prospify MCP Server Validation ===\n");

	const server = Bun.spawn(
		[
			"bun",
			"next",
			"dev",
			"--hostname",
			"127.0.0.1",
			"--port",
			String(MCP_PORT),
		],
		{
			env: {
				...process.env,
				MCP_SERVER_PORT: String(MCP_PORT),
				MCP_BASE_URL: MCP_URL,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	let passed = 0;
	let failed = 0;
	try {
		console.log("1. Starting server...");
		await waitForServer();
		console.log(`   OK: Server started on port ${MCP_PORT}`);

		console.log("\n2. Health check...");
		const health = await fetch(`${MCP_URL}/healthz`);
		const healthBody = await health.text();
		if (health.status === 200 && healthBody.includes("running")) {
			console.log("   OK: Health check passed");
			passed++;
		} else {
			console.log(`   FAIL: Status ${health.status}, body: ${healthBody}`);
			failed++;
		}

		console.log("\n3. Unauthenticated MCP request...");
		const mcp = await fetch(MCP_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "validate-mcp", version: "0.1.0" },
				},
			}),
		});
		const wwwAuthenticate = mcp.headers.get("www-authenticate") ?? "";
		if (mcp.status === 401 && wwwAuthenticate.includes("resource_metadata")) {
			console.log("   OK: MCP endpoint requires OAuth authentication");
			passed++;
		} else {
			console.log(
				`   FAIL: Expected 401 with resource metadata, received ${mcp.status}`,
			);
			failed++;
		}

		console.log("\n4. Protected resource metadata...");
		const metadataResponse = await fetch(
			`${MCP_URL}/.well-known/oauth-protected-resource`,
		);
		if (metadataResponse.status !== 200) {
			console.log(`   FAIL: Expected 200, received ${metadataResponse.status}`);
			failed++;
		} else {
			const metadata = (await metadataResponse.json()) as Record<string, unknown>;
			const servers = metadata.authorization_servers;
			if (
				typeof metadata.resource === "string" &&
				Array.isArray(servers) &&
				servers.length > 0 &&
				servers.every((value) => typeof value === "string")
			) {
				console.log("   OK: Protected resource metadata is valid");
				passed++;
			} else {
				console.log("   FAIL: Protected resource metadata is malformed");
				failed++;
			}
		}
	} finally {
		server.kill();
	}

	console.log("\n=== Validation Results ===");
	console.log(`Passed: ${passed}`);
	console.log(`Failed: ${failed}`);
	console.log(`Total:  ${passed + failed}`);

	if (failed > 0) {
		throw new Error("Validation failed");
	}
	console.log("\nAll checks passed!");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
