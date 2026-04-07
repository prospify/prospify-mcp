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

Add to your `claude_desktop_config.json`:

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

### With Claude Code

Add to your MCP config:

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

The server uses Google OAuth (the same Google account you use for prospify.app). When connecting from Claude Desktop or Claude Code, you'll be prompted to sign in with Google.

## Available Tools

| Tool | Description |
|------|-------------|
| `get-transactions` | List transactions with filters (date, account, search, category) |
| `get-accounts` | List connected bank accounts and credit cards |
| `get-cards-with-benefits` | List cards with benefit tracking configured |
| `get-benefit-summary` | YTD value captured for a card |
| `get-benefit-details` | Detailed benefit configs and usage by frequency |
| `get-subscriptions` | Detect recurring subscriptions |
| `get-credit-matches` | Pending credit-to-charge match suggestions |
| `get-available-credits` | Available credit transactions for linking |
| `get-user-profile` | User profile information |
| `get-linked-accounts` | Linked account relationships |
| `get-splitwise-status` | Splitwise connection status |
| `get-splitwise-friends` | Splitwise friends list |
| `get-splitwise-groups` | Splitwise groups with members |
| `search-transactions-for-linking` | Search credits for benefit linking |
| `edit-transaction` | Edit transaction name/amount/date |
| `delete-transaction` | Soft-delete a transaction |
| `restore-transaction` | Restore a deleted transaction |
| `change-category` | Re-categorize a transaction |
| `confirm-credit-match` | Confirm a credit-to-charge match |
| `reject-credit-match` | Reject a match suggestion |
| `mark-benefit-used` | Manually mark a benefit as used |
| `run-benefit-auto-match` | Trigger automatic benefit matching |
| `dismiss-subscription` | Dismiss a false-positive subscription |
| `restore-subscription` | Restore a dismissed subscription |
| `link-credit` | Link a credit/refund to a charge |

## Development

```bash
bun dev              # Start with hot reload
bun test             # Run tests
bun run lint         # Lint
bun run type-check   # Type check
bun run inspect      # Open MCP Inspector UI
```
