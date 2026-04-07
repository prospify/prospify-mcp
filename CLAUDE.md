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

- **FastMCP** v3.35 server with Google OAuth provider
- Queries Supabase directly using service role key (not through prospify-tools' tRPC)
- Every DB query is filtered by authenticated userId — users only see their own data
- Tools map 1:1 to prospify-tools tRPC procedures

### Key files

| File | Purpose |
|------|---------|
| `src/server.ts` | FastMCP entry point, registers tools/resources/prompts |
| `src/auth.ts` | Google OAuth → Supabase user ID resolution (5-min cache) |
| `src/db.ts` | Supabase client (service role key) |
| `src/env.ts` | Environment variable validation |
| `src/tools/transactions.ts` | 5 tools: get, edit, delete, restore, change-category |
| `src/tools/accounts.ts` | 1 tool: get-accounts |
| `src/tools/benefits.ts` | 6 tools: cards-with-benefits, summary, details, mark-used, auto-match, search |
| `src/tools/subscriptions.ts` | 3 tools: get, dismiss, restore |
| `src/tools/credits.ts` | 5 tools: matches, confirm, reject, available-credits, link |
| `src/tools/splits.ts` | 3 tools: status, friends, groups |
| `src/tools/profile.ts` | 2 tools: user-profile, linked-accounts |

### Transport modes

- **HTTP Stream** (default): `bun dev` — runs on port 4201, exposes `/mcp` endpoint
- **stdio**: `bun start --stdio` — for Claude Desktop local integration

### Auth flow

1. FastMCP's GoogleProvider handles OAuth 2.1 with PKCE
2. After Google auth, `resolveUserId()` maps the email to a Supabase user UUID
3. The UUID is cached for 5 minutes to avoid repeated `listUsers` calls
4. Each tool calls `getUserId(session)` to extract the userId from the session

## Environment

Copy `.env.example` to `.env` and fill in values from the prospify-tools project's `.env.dev`:

```
SUPABASE_URL          → NEXT_PUBLIC_SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY → NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  
SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_ID      → NEXT_PUBLIC_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET  → GOOGLE_CLIENT_SECRET
```

## Debugging

```bash
bun run inspect       # Open FastMCP Inspector UI (browser-based)
bun run test-auth     # Generate a test auth token for manual testing
```

The test-auth script creates `.auth/test-session.json` with a valid access token for use with the MCP inspector CLI.
