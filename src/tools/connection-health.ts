import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { ProspifySession } from "../auth.js";
import { getConnectionHealth } from "../lib/connection-health.js";

export function registerConnectionHealthTools(server: FastMCP<ProspifySession>) {
	server.addTool({
		name: "get-connection-health",
		description:
			"Check the health of the user's connected Plaid institutions and Splitwise account, including statuses and latest sync timestamps.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) =>
			JSON.stringify(await getConnectionHealth(session!.accessToken), null, 2),
	});
}
