/**
 * Vercel Function — catch-all route that delegates to FastMCP's Hono app.
 *
 * FastMCP exposes a Hono router via `server.getApp()` that handles:
 *   /mcp                              → MCP Streamable HTTP endpoint
 *   /healthz                          → health check
 *   /.well-known/oauth-protected-resource → RFC 9728 PRM metadata
 *
 * We call `server.start()` to register the MCP transport internally
 * (without binding a port), then re-export the Hono fetch handler
 * which Vercel invokes per-request.
 */

import { handle } from "@hono/node-server/vercel";
import { server } from "../src/server.js";

server.start({ transportType: "httpStream" });

const app = server.getApp();

export default handle(app);
