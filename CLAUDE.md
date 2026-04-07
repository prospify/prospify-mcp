# Prospify MCP Server

MCP server that exposes Prospify's personal finance data to AI assistants.

## Package Manager
Always use `bun` (not npm or pnpm).

## Development
```bash
bun install
bun dev          # Start with hot reload (HTTP mode, port 4201)
bun start        # Start in production mode
bun start --stdio  # Start in stdio mode (for local Claude Desktop)
```

## Testing
```bash
bun test:unit         # Unit tests only
bun test:integration  # Integration tests (needs Supabase credentials)
bun test:e2e          # E2E tests (starts server)
bun test              # Unit + integration
bun test:all          # All tests
```

## Linting
```bash
bun run lint       # Check
bun run format     # Auto-fix
bun run type-check # TypeScript
```

## Architecture
- **FastMCP** server with Google OAuth → Supabase user lookup
- Queries Supabase directly (service role key, always filtered by userId)
- Tools map to prospify-tools tRPC procedures
- `src/auth.ts` — Google OAuth + email→userId resolution with caching
- `src/db.ts` — Supabase client
- `src/tools/*.ts` — MCP tool definitions grouped by domain
- `tests/unit/` — Schema validation, fixture tests
- `tests/integration/` — Real Supabase queries
- `tests/e2e/` — Server startup, health check, MCP protocol

## Environment
Copy `.env.example` to `.env` and fill in values from the prospify-tools project.
