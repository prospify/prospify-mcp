# Prospify MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes your [Prospify](https://prospify.app) personal finance data to AI assistants like Claude.

## What can it do?

- **Transactions** — Search, filter, edit, delete, restore, and re-categorize transactions
- **Credit Card Benefits** — View benefit dashboards, track usage, auto-match benefits to transactions
- **Subscriptions** — Detect recurring subscriptions from transaction patterns
- **Credit Reconciliation** — View and confirm credit-to-charge matches
- **Splitwise** — Check connection status, list friends and groups
- **Profile** — View user profile and linked account relationships

## Quick Start

### With Claude Code

```bash
claude mcp add --transport http prospify https://mcp.prospify.app/mcp
```

The first call triggers OAuth 2.1 + PKCE. Your browser opens Prospify's consent page; pick **Read-only** (default) or **Read and write**, click approve, and you're done. Claude Code caches the refresh token for subsequent sessions.

### With Claude Desktop

Claude Desktop speaks the same Streamable HTTP transport. Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prospify": {
      "url": "https://mcp.prospify.app/mcp"
    }
  }
}
```

Restart Claude Desktop, click the Prospify entry, and complete the OAuth consent flow in your browser.

### Run the server locally

```bash
git clone <repo-url>
cd prospify-mcp
cp .env.example .env  # Fill in SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
bun install
bun dev  # HTTP mode on port 4201
```

## Authentication

The server is a pure **OAuth 2.1 Protected Resource** (MCP spec 2025-03-26). All authentication is delegated to Supabase's built-in OAuth server, and row-level security is enforced by Postgres.

```
Claude Desktop / Claude Code
        │
        │  1. MCP request, no token
        ▼
  prospify-mcp           2. 401 + WWW-Authenticate with
  (this server)             resource_metadata pointing at
                            /.well-known/oauth-protected-resource
        │
        │  3. Client reads PRM → Supabase Authorization Server
        ▼
  Supabase Auth          4. Dynamic client registration
  (OAuth 2.1 server)        /auth/v1/oauth/clients/register
        │
        │  5. /oauth/authorize (PKCE) → browser opens
        ▼
  prospify.app/oauth/consent  6. User approves, picks scope
        │
        ▼
  Supabase → /oauth/token  7. PKCE code exchange → signed JWT
        │
        │  8. Client retries MCP request with
        │     Authorization: Bearer <jwt>
        ▼
  prospify-mcp           9. jwtVerify via JWKS (ES256)
                           → per-request Supabase client
                           → RLS enforces auth.uid()
```

**Properties:**

- The MCP server holds **zero admin credentials**. No service role key, no Google OAuth secrets, no email→user lookups.
- A compromise of the server's env leaks only the Supabase **publishable key** (the same one that ships in the web client).
- RLS is the sole authorization layer; every tool uses a `createUserSupabaseClient(jwt)` with the caller's token attached, and `auth.uid()` in the policies does the row filtering.
- A `client_id` claim is required on every token — proving it came through the OAuth flow and not, say, a leaked password-grant JWT. An optional `MCP_ALLOWED_CLIENT_IDS` env var pins acceptance to registered clients in production.

See `src/auth.ts` and `src/supabase-client.ts` for the full implementation.

## Available Tools

### Read-Only (Queries)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `get-transactions` | `accountId?`, `startDate?`, `endDate?`, `search?`, `category?`, `limit?`, `offset?` | List transactions with filters |
| `get-accounts` | *(none)* | List connected bank accounts and credit cards |
| `get-cards-with-benefits` | *(none)* | List cards with benefit tracking configured |
| `get-benefit-summary` | `accountId` | YTD value captured vs annual fee |
| `get-benefit-details` | `accountId`, `frequency` | Benefit configs and usage for a frequency |
| `get-subscriptions` | *(none)* | Detect recurring subscriptions from patterns |
| `get-credit-matches` | `limit?` | Pending credit-to-charge match suggestions |
| `get-available-credits` | `accountId?`, `search?` | Credit transactions for linking |
| `get-user-profile` | *(none)* | User profile (age, income, credit score) |
| `get-linked-accounts` | *(none)* | Primary/authorized user card relationships |
| `get-splitwise-status` | *(none)* | Splitwise connection status |
| `get-splitwise-friends` | *(none)* | Splitwise friends list |
| `get-splitwise-groups` | *(none)* | Splitwise groups with members |
| `search-transactions-for-linking` | `accountId`, `search?`, `limit?` | Search credits for benefit linking |

### Mutations (Actions)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `edit-transaction` | `transactionId`, `name?`, `amount?`, `date?` | Edit transaction display data |
| `delete-transaction` | `transactionId` | Soft-delete (reversible) |
| `restore-transaction` | `transactionId` | Undo deletion |
| `change-category` | `transactionId`, `newCategory`, `applyToAll?` | Re-categorize |
| `confirm-credit-match` | `suggestionId` | Confirm a credit-to-charge match |
| `reject-credit-match` | `suggestionId` | Reject a match suggestion |
| `mark-benefit-used` | `benefitConfigId`, `amountUsed`, `note?` | Manual benefit tracking |
| `run-benefit-auto-match` | `accountId` | Auto-match benefits to transactions |
| `dismiss-subscription` | `merchantKey`, `accountId` | Hide false-positive subscription |
| `restore-subscription` | `merchantKey`, `accountId` | Restore dismissed subscription |
| `link-credit` | `chargeTransactionId`, `creditTransactionId`, `creditAmount`, `note?` | Link refund to charge |

### Prompts

| Prompt | Description |
|--------|-------------|
| `spending-analysis` | Analyze spending patterns by category with trends and suggestions |
| `benefit-optimizer` | Suggest which card to use for a purchase category |

### Resources

| URI | Description |
|-----|-------------|
| `prospify://accounts` | Connected accounts (JSON) |

## Development

```bash
bun dev              # Start with hot reload (HTTP mode, port 4201)
bun start            # Start in HTTP mode (no watch)
bun test             # Run unit + integration tests
bun test:all         # Run all tests including E2E
bun run lint         # Lint with Biome
bun run type-check   # TypeScript type check
bun run inspect      # Open MCP Inspector UI
bun run test-auth    # Generate a dev JWT for the MCP inspector
```

## Testing

```bash
bun test:unit         # Unit tests (no external deps)
bun test:integration  # Integration tests (needs SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY + SUPABASE_SERVICE_ROLE_KEY for the JWT-minting test helper)
bun test:e2e          # E2E tests (spawns server instances)
bun test:all          # Everything
```

Integration tests deliberately use a **user-scoped** Supabase client — none of the queries carry a `.eq("user_id", ...)` filter. If any of the "cannot see other user's rows" tests start returning data, RLS regressed and we have a security incident.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable (anon) key — the one that ships with the web client |
| `MCP_ALLOWED_CLIENT_IDS` | No | Comma-separated allowlist of Supabase OAuth client IDs. Empty = accept any OAuth-issued token (required for DCR). Set this in production if you want to pin to specific clients. |
| `MCP_SERVER_PORT` | No | Server port (default: 4201) |
| `MCP_BASE_URL` | No | Public base URL used as `resource` in the PRM metadata (default: http://localhost:4201) |

Notably absent: `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. The MCP server never needs them.
