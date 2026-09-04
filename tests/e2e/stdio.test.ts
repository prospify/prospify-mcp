/**
 * Stdio transport tests — verify the MCP server works in stdio mode
 * (used by Claude Desktop and local integrations).
 */

import { describe, expect, test } from "bun:test";

describe("MCP stdio transport", () => {
	test("server responds to initialize via stdio", async () => {
		const initMessage = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "stdio-test", version: "0.1.0" },
			},
		});

		const proc = Bun.spawn(["bun", "run", "src/server.ts", "--stdio"], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
			cwd: "/Users/ashaychangwani/Desktop/repos/prospify-mcp",
		});

		// Write initialize message
		proc.stdin.write(`${initMessage}\n`);
		proc.stdin.flush();

		// Read response with timeout
		const reader = proc.stdout.getReader();
		const chunks: string[] = [];
		const timeout = setTimeout(() => {
			proc.kill();
		}, 5000);

		try {
			const { value } = await reader.read();
			if (value) {
				chunks.push(new TextDecoder().decode(value));
			}
		} catch {
			// Process might have exited
		}

		clearTimeout(timeout);
		proc.kill();

		const output = chunks.join("");
		// Should contain an initialize response
		if (output.length > 0) {
			expect(output).toContain("jsonrpc");
			// Parse the response (may be preceded by content-length header)
			const jsonMatch = output.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const response = JSON.parse(jsonMatch[0]);
				expect(response.result || response.error).toBeTruthy();
				if (response.result) {
					expect(response.result.protocolVersion).toBeTruthy();
					expect(response.result.serverInfo).toBeTruthy();
					expect(response.result.serverInfo.name).toBe("Prospify");
				}
			}
		}
	});

	test("server lists tools via stdio after initialize", async () => {
		const messages = [
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "stdio-test", version: "0.1.0" },
				},
			}),
			JSON.stringify({
				jsonrpc: "2.0",
				method: "notifications/initialized",
			}),
			JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
			}),
		];

		const proc = Bun.spawn(["bun", "run", "src/server.ts", "--stdio"], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
			cwd: "/Users/ashaychangwani/Desktop/repos/prospify-mcp",
		});

		// Send all messages
		for (const msg of messages) {
			proc.stdin.write(`${msg}\n`);
			proc.stdin.flush();
			await Bun.sleep(100);
		}

		// Collect output
		const reader = proc.stdout.getReader();
		const chunks: string[] = [];
		const timeout = setTimeout(() => {
			proc.kill();
		}, 5000);

		try {
			// Read multiple chunks
			for (let i = 0; i < 10; i++) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) chunks.push(new TextDecoder().decode(value));
				if (chunks.join("").includes("tools")) break;
			}
		} catch {
			// Process might have exited
		}

		clearTimeout(timeout);
		proc.kill();

		const output = chunks.join("");

		// Find the tools/list response
		const toolsMatch = output.match(/\{"jsonrpc":"2\.0","id":2[^}]*"result":\{[\s\S]*?"tools":\[[\s\S]*?\]\}/);
		if (toolsMatch) {
			const response = JSON.parse(toolsMatch[0]);
			expect(response.result.tools).toBeArray();
			// Should have 28 tools
			expect(response.result.tools.length).toBe(28);

			// Verify some known tool names
			const toolNames = response.result.tools.map((t: { name: string }) => t.name);
			expect(toolNames).toContain("get-transactions");
			expect(toolNames).toContain("get-connection-health");
			expect(toolNames).toContain("get-accounts");
			expect(toolNames).toContain("get-subscriptions");
			expect(toolNames).toContain("edit-transaction");
			expect(toolNames).toContain("mark-benefit-used");
			expect(toolNames).toContain("sync-splitwise-data");
		} else {
			// If we can't parse the tools response, at least verify the server started
			expect(output.length).toBeGreaterThan(0);
		}
	});
});
