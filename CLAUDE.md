# Prospify MCP Server

MCP server that exposes Prospify's personal finance data to AI assistants via the Model Context Protocol.

## Package Manager
Always use `bun` (not npm or pnpm).

## Development

```bash
bun install          # Install dependencies
bun dev              # Start with hot reload (HTTP mode, port 4201)
bun start            # Start in production mode
bun start --stdio    # Start in stdio mode (for Claude Desktop)
```

## Testing

```bash
bun test:unit         # Unit tests (no external deps needed)
bun test:integration  # Integration tests (requires Supabase credentials in .env)
bun test:e2e          # E2E tests (spawns server processes, tests protocol)
bun test              # Unit + integration
bun test:all          # All 138 tests
bun run validate      # Protocol-level validation (health, OAuth, MCP handshake)
```

Test categories:
- **Unit** (53 tests): Auth logic, env validation, fixtures, all Zod parameter schemas, LIKE injection prevention, string length limits, security
- **Integration** (27 tests): Real Supabase queries, auth email→userId resolution, cross-user access control, SQL injection safety, boundary conditions
- **E2E** (39 tests): HTTP server lifecycle, health endpoint, OAuth RFC 8414/9728 compliance, stdio transport, MCP SDK client tests, tool argument validation, annotation checks

## Linting

```bash
bun run lint       # Check (Biome)
bun run format     # Auto-fix
bun run type-check # TypeScript strict mode
```

## Architecture

- **FastMCP** server, pure OAuth 2.1 Protected Resource (MCP spec 2025-03-26)
- Authentication is delegated to **Supabase's built-in OAuth server**; this server holds zero admin credentials
- Every tool builds a **per-request user-scoped Supabase client** from the caller's JWT
- **Row-level security** (`auth.uid()`) is the sole authorization layer — no `.eq("user_id", ...)` filters anywhere

### Key files

| File | Purpose |
|------|---------|
| `src/server.ts` | FastMCP entry point, registers tools/resources/prompts, wires `authenticate` + PRM metadata |
| `src/auth.ts` | JWT verification via Supabase JWKS (ES256); returns `ProspifySession` or throws 401 + `WWW-Authenticate` |
| `src/supabase-client.ts` | `createUserSupabaseClient(accessToken)` — per-request RLS-scoped client |
| `src/env.ts` | Environment variable validation (no service role, no Google) |
| `src/tools/transactions.ts` | 5 tools: get, edit, delete, restore, change-category |
| `src/tools/accounts.ts` | 1 tool: get-accounts |
| `src/tools/benefits.ts` | 7 tools: cards-with-benefits, summary, details, mark-used, auto-match, search, (legacy helper) |
| `src/tools/subscriptions.ts` | 3 tools: get, dismiss, restore |
| `src/tools/credits.ts` | 5 tools: matches, confirm, reject, available-credits, link |
| `src/tools/splits.ts` | 3 tools: status, friends, groups |
| `src/tools/profile.ts` | 2 tools: user-profile, linked-accounts |

### Transport modes

- **HTTP Stream** (default): `bun dev` — runs on port 4201, exposes `/mcp` endpoint
- **stdio**: `bun start --stdio` — available but unused in production; stdio mode has no way to present a JWT, so it exists mainly for protocol tests

### Auth flow

1. MCP client hits `/mcp` with no token → server returns 401 with `WWW-Authenticate: Bearer resource_metadata=…`
2. Client fetches `/.well-known/oauth-protected-resource` → learns about Supabase as the Authorization Server
3. Client does Dynamic Client Registration at Supabase (`/auth/v1/oauth/clients/register`)
4. Client walks OAuth 2.1 + PKCE: `/authorize` → browser → `prospify.app/oauth/consent` → user approves → `/token`
5. Client retries the MCP request with `Authorization: Bearer <jwt>`
6. `src/auth.ts` verifies signature via JWKS (`ES256`), checks `iss`, `aud`, `exp`, and requires the `client_id` claim
7. Tools build `createUserSupabaseClient(session.accessToken)` — RLS enforces row scoping

## Environment

Copy `.env.example` to `.env` and fill in:

```
SUPABASE_URL              → https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY  → anon/publishable key (public value, same one ships in the web client)
MCP_ALLOWED_CLIENT_IDS    → optional, comma-separated OAuth client allowlist (empty = accept any DCR-registered client)
MCP_SERVER_PORT           → default 4201
MCP_BASE_URL              → default http://localhost:4201
```

Deliberately absent: `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. The MCP server never needs them.

## Debugging

```bash
bun run inspect       # Open FastMCP Inspector UI (browser-based)
bun run test-auth     # Generate a dev JWT for use with the MCP inspector CLI
```

The `test-auth` script signs in as the dev user via password grant (using the service role key from `.env` to set a temporary password). It's a convenience for local debugging; the server itself doesn't care.
