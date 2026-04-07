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

### With Claude Desktop

Add to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prospify": {
      "command": "bun",
      "args": ["run", "/path/to/prospify-mcp/src/server.ts", "--stdio"]
    }
  }
}
```

Restart Claude Desktop. You'll see a tools icon indicating Prospify tools are available.

### With Claude Code

Add to your project's `.mcp.json` or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "prospify": {
      "type": "streamable-http",
      "url": "http://localhost:4201/mcp"
    }
  }
}
```

### Run the server

```bash
git clone <repo-url>
cd prospify-mcp
cp .env.example .env  # Fill in Supabase + Google OAuth credentials
bun install
bun dev  # HTTP mode on port 4201
```

## Authentication

The server uses **Google OAuth 2.1** (the same Google account you use for prospify.app). The flow:

1. MCP client (Claude Desktop/Code) discovers OAuth endpoints via `/.well-known/oauth-authorization-server`
2. User is redirected to Google sign-in
3. After auth, the server maps the Google email to your Supabase user ID
4. All subsequent MCP requests use this authenticated session

For **stdio mode** (Claude Desktop), auth is handled automatically via the OAuth flow.
For **HTTP mode** (Claude Code), the client sends `Authorization: Bearer <token>` on every request.

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

## Architecture

```
Claude Desktop / Claude Code
        |
        |  MCP Protocol (stdio or HTTP Stream)
        v
+-------------------------+
|   prospify-mcp server   |  <-- FastMCP + Bun
|   (port 4201)           |
|                         |
|  Google OAuth           |  User signs in with same Google account
|  -> Supabase user ID   |  Email mapped to Supabase UUID
|  -> Direct DB queries   |  Service role key, always userId-filtered
+-------------------------+
        |
        v
   Supabase (PostgreSQL)
```

The server talks directly to Supabase using the service role key (bypassing RLS). Every query is filtered by the authenticated user's ID — users can only access their own data.

## Development

```bash
bun dev              # Start with hot reload (HTTP mode, port 4201)
bun start --stdio    # Start in stdio mode (for Claude Desktop)
bun test             # Run unit + integration tests
bun test:all         # Run all tests including E2E
bun run lint         # Lint with Biome
bun run type-check   # TypeScript type check
bun run validate     # Protocol-level validation
bun run inspect      # Open MCP Inspector UI
bun run test-auth    # Generate test auth tokens
```

## Testing

The test suite includes 87 tests across 11 files:

| Category | Tests | What's tested |
|----------|-------|---------------|
| Unit | 33 | Auth logic, env validation, fixtures, all tool parameter schemas |
| Integration | 26 | Real Supabase queries, auth resolution, cross-user access control, SQL injection safety, edge cases |
| E2E (Protocol) | 16 | Server startup, health check, OAuth discovery (RFC 8414/9728), MCP protocol, stdio transport |
| E2E (MCP Client) | 12 | Full MCP SDK client tests — tools/list, tool calling, prompts, resources, auth guards |

```bash
bun test:unit         # Unit tests (no external deps)
bun test:integration  # Integration tests (needs Supabase credentials)
bun test:e2e          # E2E tests (starts server instances)
bun test:all          # Everything
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anonymous/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only) |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `MCP_SERVER_PORT` | No | Server port (default: 4201) |
| `MCP_BASE_URL` | No | Base URL for OAuth callbacks (default: http://localhost:4201) |
