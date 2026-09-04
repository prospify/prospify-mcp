/**
 * Start the supported Next.js HTTP server, while preserving the historical
 * `bun start --stdio` convenience for local MCP clients and protocol tests.
 */

export {};

const isStdio = process.argv.includes("--stdio");
const command = isStdio
	? ["bun", "run", "src/server.ts", "--stdio"]
	: [
			"bun",
			"next",
			"start",
			"--hostname",
			"127.0.0.1",
			"--port",
			process.env.MCP_SERVER_PORT || "4201",
		];

const child = Bun.spawn(command, {
	env: process.env,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

process.exit(await child.exited);
