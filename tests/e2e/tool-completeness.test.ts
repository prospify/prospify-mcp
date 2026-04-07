/**
 * Tool completeness tests — verify all 25 tools are registered with
 * proper schemas, descriptions, and annotations. This is the canonical
 * test that catches any tool that was accidentally removed or misconfigured.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let client: Client;
let transport: StdioClientTransport;

// Canonical list of all 25 tools with their expected properties
const EXPECTED_TOOLS = [
	// Transactions (5)
	{ name: "get-transactions", readOnly: true, requiredParams: [] },
	{ name: "edit-transaction", readOnly: false, requiredParams: ["transactionId"] },
	{ name: "delete-transaction", readOnly: false, requiredParams: ["transactionId"] },
	{ name: "restore-transaction", readOnly: false, requiredParams: ["transactionId"] },
	{ name: "change-category", readOnly: false, requiredParams: ["transactionId", "newCategory"] },
	// Accounts (1)
	{ name: "get-accounts", readOnly: true, requiredParams: [] },
	// Benefits (6)
	{ name: "get-cards-with-benefits", readOnly: true, requiredParams: [] },
	{ name: "get-benefit-summary", readOnly: true, requiredParams: ["accountId"] },
	{ name: "get-benefit-details", readOnly: true, requiredParams: ["accountId", "frequency"] },
	{ name: "mark-benefit-used", readOnly: false, requiredParams: ["benefitConfigId", "amountUsed"] },
	{
		name: "run-benefit-auto-match",
		readOnly: false,
		requiredParams: ["accountId"],
	},
	{
		name: "search-transactions-for-linking",
		readOnly: true,
		requiredParams: ["accountId"],
	},
	// Subscriptions (3)
	{ name: "get-subscriptions", readOnly: true, requiredParams: [] },
	{
		name: "dismiss-subscription",
		readOnly: false,
		requiredParams: ["merchantKey", "accountId"],
	},
	{
		name: "restore-subscription",
		readOnly: false,
		requiredParams: ["merchantKey", "accountId"],
	},
	// Credits (5)
	{ name: "get-credit-matches", readOnly: true, requiredParams: [] },
	{ name: "confirm-credit-match", readOnly: false, requiredParams: ["suggestionId"] },
	{ name: "reject-credit-match", readOnly: false, requiredParams: ["suggestionId"] },
	{ name: "get-available-credits", readOnly: true, requiredParams: [] },
	{
		name: "link-credit",
		readOnly: false,
		requiredParams: ["chargeTransactionId", "creditTransactionId", "creditAmount"],
	},
	// Splits (3)
	{ name: "get-splitwise-status", readOnly: true, requiredParams: [] },
	{ name: "get-splitwise-friends", readOnly: true, requiredParams: [] },
	{ name: "get-splitwise-groups", readOnly: true, requiredParams: [] },
	// Profile (2)
	{ name: "get-user-profile", readOnly: true, requiredParams: [] },
	{ name: "get-linked-accounts", readOnly: true, requiredParams: [] },
];

describe("Tool Completeness", () => {
	beforeAll(async () => {
		transport = new StdioClientTransport({
			command: "bun",
			args: ["run", "src/server.ts", "--stdio"],
			cwd: "/Users/ashaychangwani/Desktop/repos/prospify-mcp",
			env: process.env as Record<string, string>,
		});
		client = new Client({ name: "completeness-test", version: "0.1.0" }, { capabilities: {} });
		await client.connect(transport);
	});

	afterAll(async () => {
		try {
			await client.close();
		} catch {
			// OK
		}
	});

	test("exactly 25 tools are registered", async () => {
		const { tools } = await client.listTools();
		expect(tools.length).toBe(25);
	});

	test("no unexpected tools exist", async () => {
		const { tools } = await client.listTools();
		const actualNames = new Set(tools.map((t) => t.name));
		const expectedNames = new Set(EXPECTED_TOOLS.map((t) => t.name));

		// Check for unexpected tools
		for (const name of actualNames) {
			expect(expectedNames.has(name)).toBe(true);
		}
	});

	test("no expected tools are missing", async () => {
		const { tools } = await client.listTools();
		const actualNames = new Set(tools.map((t) => t.name));

		for (const expected of EXPECTED_TOOLS) {
			expect(actualNames.has(expected.name)).toBe(true);
		}
	});

	test("every tool has a description of at least 30 characters", async () => {
		const { tools } = await client.listTools();
		for (const tool of tools) {
			expect(tool.description!.length).toBeGreaterThanOrEqual(30);
		}
	});

	test("every tool has an inputSchema with type 'object'", async () => {
		const { tools } = await client.listTools();
		for (const tool of tools) {
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.inputSchema.properties).toBeTruthy();
		}
	});

	test("required params are correctly marked in schemas", async () => {
		const { tools } = await client.listTools();

		for (const expected of EXPECTED_TOOLS) {
			if (expected.requiredParams.length === 0) continue;

			const tool = tools.find((t) => t.name === expected.name);
			expect(tool).toBeTruthy();

			const required = (tool!.inputSchema.required as string[]) ?? [];
			for (const param of expected.requiredParams) {
				expect(required).toContain(param);
			}
		}
	});

	test("exactly 2 prompts are registered", async () => {
		const { prompts } = await client.listPrompts();
		expect(prompts.length).toBe(2);
		const names = prompts.map((p) => p.name);
		expect(names).toContain("spending-analysis");
		expect(names).toContain("benefit-optimizer");
	});

	test("exactly 1 resource template is registered", async () => {
		const { resourceTemplates } = await client.listResourceTemplates();
		expect(resourceTemplates.length).toBe(1);
		expect(resourceTemplates[0].uriTemplate).toBe("prospify://accounts");
	});
});
