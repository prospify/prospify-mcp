/**
 * Prospify MCP Server
 *
 * Exposes Prospify's personal finance data to AI assistants via the
 * Model Context Protocol. Authenticated via Google OAuth (same account
 * used for prospify.app).
 */

import { FastMCP } from "fastmcp";
import { authProvider } from "./auth.js";
import { env } from "./env.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerBenefitTools } from "./tools/benefits.js";
import { registerCreditTools } from "./tools/credits.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerSplitTools } from "./tools/splits.js";
import { registerSubscriptionTools } from "./tools/subscriptions.js";
import { registerTransactionTools } from "./tools/transactions.js";

const server = new FastMCP({
	name: "Prospify",
	version: "0.1.0",
	auth: authProvider,
	health: {
		enabled: true,
		message: "Prospify MCP server is running",
		path: "/healthz",
		status: 200,
	},
});

// Register all tools
registerTransactionTools(server);
registerAccountTools(server);
registerBenefitTools(server);
registerSubscriptionTools(server);
registerCreditTools(server);
registerSplitTools(server);
registerProfileTools(server);

// Register resources
server.addResourceTemplate({
	uriTemplate: "prospify://accounts",
	name: "Connected Accounts",
	description: "List of all connected bank accounts and credit cards",
	mimeType: "application/json",
	arguments: [],
	load: async (_args, auth) => {
		const { getUserId } = await import("./auth.js");
		const { supabase } = await import("./db.js");
		const userId = await getUserId(auth);

		const { data } = await supabase
			.from("accounts")
			.select("id, name, mask, type, subtype, current_balance")
			.eq("user_id", userId);

		return { text: JSON.stringify(data ?? [], null, 2) };
	},
});

// Register prompts
server.addPrompt({
	name: "spending-analysis",
	description:
		"Analyze spending patterns. Use get-transactions and get-subscriptions tools to pull data, then summarize spending by category, identify trends, and suggest optimizations.",
	arguments: [
		{
			name: "timeframe",
			description: "Time period to analyze (e.g., 'last month', 'last 3 months', 'this year')",
			required: false,
		},
	],
	load: async (args) => {
		const timeframe = args.timeframe || "last 30 days";
		return `Analyze the user's spending patterns for the ${timeframe}. Steps:

1. Use get-transactions to fetch recent transactions
2. Use get-subscriptions to identify recurring charges
3. Use get-accounts to understand which accounts/cards are being used

Then provide:
- Spending breakdown by category (top 5-10 categories)
- Total spending for the period
- Largest individual transactions
- Active subscriptions and their monthly cost
- Any unusual spending patterns or spikes
- Suggestions for which credit card benefits the user could be using more`;
	},
});

server.addPrompt({
	name: "benefit-optimizer",
	description:
		"Suggest which credit card to use for a specific purchase category based on configured benefits.",
	arguments: [
		{
			name: "category",
			description: "Purchase category (e.g., 'dining', 'travel', 'groceries', 'gas', 'streaming')",
			required: true,
		},
	],
	load: async (args) => {
		return `Help the user choose the best credit card for "${args.category}" purchases. Steps:

1. Use get-cards-with-benefits to see which cards have benefit tracking
2. Use get-benefit-details for each card to see available benefits
3. Use get-benefit-summary to see how much value they've already captured

Then recommend:
- Which card has the best rewards/benefits for "${args.category}"
- Whether any benefits related to "${args.category}" are unused this period
- The dollar value of using the recommended card vs others`;
	},
});

// Start server
const transportType = process.argv.includes("--stdio") ? "stdio" : "httpStream";

if (transportType === "stdio") {
	server.start({ transportType: "stdio" });
	console.error("Prospify MCP server started (stdio mode)");
} else {
	server.start({
		transportType: "httpStream",
		httpStream: {
			port: env.MCP_SERVER_PORT,
		},
	});
	console.log(`Prospify MCP server started on port ${env.MCP_SERVER_PORT}`);
	console.log(`Health check: http://localhost:${env.MCP_SERVER_PORT}/healthz`);
	console.log(`MCP endpoint: http://localhost:${env.MCP_SERVER_PORT}/mcp`);
}
