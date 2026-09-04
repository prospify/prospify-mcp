/**
 * MCP SDK Client tests — test the server using the official MCP TypeScript
 * client library, simulating exactly what Claude Desktop/Code does.
 *
 * Uses stdio transport to spawn the server and communicate via JSON-RPC.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let client: Client;
let transport: StdioClientTransport;

describe("MCP SDK Client", () => {
	beforeAll(async () => {
		transport = new StdioClientTransport({
			command: "bun",
			args: ["run", "src/server.ts", "--stdio"],
			cwd: "/Users/ashaychangwani/Desktop/repos/prospify-mcp",
			env: process.env as Record<string, string>,
		});

		client = new Client(
			{
				name: "test-client",
				version: "0.1.0",
			},
			{
				capabilities: {},
			},
		);

		await client.connect(transport);
	});

	afterAll(async () => {
		try {
			await client.close();
		} catch {
			// Server may already be closed
		}
	});

	// --- Protocol Handshake ---

	test("client successfully connected", () => {
		// If we got here, the initialize handshake worked
		expect(client).toBeTruthy();
	});

	// --- Tools ---

	test("tools/list returns exactly 28 tools", async () => {
		const result = await client.listTools();
		expect(result.tools).toBeArray();
		expect(result.tools.length).toBe(28);
	});

	test("each tool has name, description, and inputSchema", async () => {
		const result = await client.listTools();
		for (const tool of result.tools) {
			expect(tool.name).toBeString();
			expect(tool.name.length).toBeGreaterThan(0);
			expect(tool.description).toBeString();
			expect(tool.description!.length).toBeGreaterThan(10);
			expect(tool.inputSchema).toBeTruthy();
			expect(tool.inputSchema.type).toBe("object");
		}
	});

	test("all expected tool names are present", async () => {
		const result = await client.listTools();
		const names = result.tools.map((t) => t.name);

		const expectedTools = [
			"get-connection-health",
			"get-transactions",
			"refresh-transactions",
			"get-accounts",
			"get-cards-with-benefits",
			"get-benefit-summary",
			"get-benefit-details",
			"get-subscriptions",
			"get-credit-matches",
			"get-available-credits",
			"get-user-profile",
			"get-linked-accounts",
			"get-splitwise-status",
			"sync-splitwise-data",
			"get-splitwise-friends",
			"get-splitwise-groups",
			"search-transactions-for-linking",
			"edit-transaction",
			"delete-transaction",
			"restore-transaction",
			"change-category",
			"confirm-credit-match",
			"reject-credit-match",
			"mark-benefit-used",
			"run-benefit-auto-match",
			"dismiss-subscription",
			"restore-subscription",
			"link-credit",
		];

		for (const expected of expectedTools) {
			expect(names).toContain(expected);
		}
	});

	test("get-transactions tool has correct parameter schema", async () => {
		const result = await client.listTools();
		const getTx = result.tools.find((t) => t.name === "get-transactions");
		expect(getTx).toBeTruthy();

		const schema = getTx!.inputSchema;
		expect(schema.properties).toBeTruthy();

		const props = schema.properties as Record<string, { type?: string }>;
		expect(props.accountId).toBeTruthy();
		expect(props.startDate).toBeTruthy();
		expect(props.endDate).toBeTruthy();
		expect(props.search).toBeTruthy();
		expect(props.limit).toBeTruthy();
	});

	// --- Tool Execution (auth guard) ---

	test("calling a tool without auth returns error content", async () => {
		// In stdio mode without Google OAuth, the session is undefined
		// Tools should throw an auth error
		try {
			const result = await client.callTool({
				name: "get-accounts",
				arguments: {},
			});

			// If we get a result, check if it contains an error about auth
			if (result.content && Array.isArray(result.content)) {
				const textContent = result.content.find(
					(c) => c.type === "text",
				) as { type: "text"; text: string } | undefined;
				if (textContent) {
					// Should mention authentication
					expect(
						textContent.text.includes("Authentication") ||
							textContent.text.includes("auth") ||
							textContent.text.includes("sign in") ||
							result.isError === true,
					).toBe(true);
				}
			}
		} catch (e) {
			// An error is also acceptable — auth is not set up in stdio test mode
			expect(e).toBeTruthy();
		}
	});

	test("calling non-existent tool returns error", async () => {
		try {
			await client.callTool({
				name: "nonexistent-tool",
				arguments: {},
			});
			// Should not reach here
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeTruthy();
		}
	});

	// --- Prompts ---

	test("prompts/list returns 2 prompts", async () => {
		const result = await client.listPrompts();
		expect(result.prompts).toBeArray();
		expect(result.prompts.length).toBe(2);

		const names = result.prompts.map((p) => p.name);
		expect(names).toContain("spending-analysis");
		expect(names).toContain("benefit-optimizer");
	});

	test("spending-analysis prompt has optional timeframe argument", async () => {
		const result = await client.listPrompts();
		const prompt = result.prompts.find((p) => p.name === "spending-analysis");
		expect(prompt).toBeTruthy();
		expect(prompt!.arguments).toBeArray();

		const timeframeArg = prompt!.arguments!.find((a) => a.name === "timeframe");
		expect(timeframeArg).toBeTruthy();
		expect(timeframeArg!.required).toBe(false);
	});

	test("benefit-optimizer prompt has required category argument", async () => {
		const result = await client.listPrompts();
		const prompt = result.prompts.find((p) => p.name === "benefit-optimizer");
		expect(prompt).toBeTruthy();

		const categoryArg = prompt!.arguments!.find((a) => a.name === "category");
		expect(categoryArg).toBeTruthy();
		expect(categoryArg!.required).toBe(true);
	});

	test("can get a prompt with arguments", async () => {
		const result = await client.getPrompt({
			name: "spending-analysis",
			arguments: { timeframe: "last 3 months" },
		});

		expect(result.messages).toBeArray();
		expect(result.messages.length).toBeGreaterThan(0);
		const text = (result.messages[0].content as { type: string; text: string }).text;
		expect(text).toContain("last 3 months");
		expect(text).toContain("get-transactions");
	});

	// --- Resources ---

	test("resource templates list includes accounts", async () => {
		const result = await client.listResourceTemplates();
		expect(result.resourceTemplates).toBeArray();

		const accountsTemplate = result.resourceTemplates.find(
			(r) => r.uriTemplate === "prospify://accounts",
		);
		expect(accountsTemplate).toBeTruthy();
		expect(accountsTemplate!.name).toBe("Connected Accounts");
	});
});
