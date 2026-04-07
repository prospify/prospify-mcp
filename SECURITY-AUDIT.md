# Prospify Security Audit Report

**Date**: 2026-04-07  
**Scope**: prospify-mcp (MCP server) + prospify-tools (web app) + infrastructure  
**Method**: Automated code review by 3 parallel security audit agents

---

## Executive Summary

| Severity | MCP Server | Web App | Infrastructure | Total |
|----------|-----------|---------|---------------|-------|
| Critical | 1 | 2 | 1 | **4** |
| High | 5 | 4 | 2 | **11** |
| Medium | 3 | 5 | 2 | **10** |
| Low | 4 | 3 | 1 | **8** |

**Top 5 urgent fixes:**
1. Setup router IDOR — any user can read/modify/delete any other user's profile
2. Plaid webhook has no signature verification — forged webhooks accepted
3. `anon` role has INSERT/UPDATE/DELETE on all tables — overly permissive
4. MCP `change-category` UPDATE has no userId filter — IDOR on mutation
5. Plaid/Splitwise tokens stored in plaintext — encrypt at rest

---

## CRITICAL Findings

### C1: Setup Router IDOR (prospify-tools)
**File**: `src/server/api/routers/setup.ts`  
All four CRUD operations accept a user-supplied `id` without verifying `ctx.user.id` matches. Any authenticated user can read, update, or delete any other user's profile.  
**Fix**: Replace `input.id` with `ctx.user.id` in all operations.

### C2: Plaid Webhook No Authentication (prospify-tools)
**File**: `src/app/api/webhooks/plaid/route.ts`  
No Plaid webhook signature verification. Attacker can forge webhooks to trigger transaction syncs or manipulate item statuses.  
**Fix**: Implement Plaid JWT webhook verification.

### C3: Overly Permissive `anon` Role Grants (infrastructure)
**File**: `setup-rls-policies.sql` line 960  
`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO anon`. If any table has RLS disabled or a permissive policy, anonymous users can write data.  
**Fix**: Restrict `anon` to `SELECT` only on specific reference tables.

### C4: MCP `change-category` IDOR (prospify-mcp)
**File**: `src/tools/transactions.ts` line 234  
The UPDATE runs on `transactions_table` filtered only by transaction ID with no `user_id` filter.  
**Fix**: Add `.eq("user_id", userId)` to the update query.

---

## HIGH Findings

### H1: MCP User List Pagination Failure
**File**: `prospify-mcp/src/auth.ts` line 35  
`listUsers()` fetches only page 1 (max 1000 users). Users beyond page 1 are permanently locked out.  
**Fix**: Paginate all pages or use single-user lookup by email.

### H2: MCP IDOR on Benefit Summary/Details
**File**: `prospify-mcp/src/tools/benefits.ts` lines 85-88  
`credit_card_details` queried by `account_id` without verifying account belongs to the user.  
**Fix**: Join through `accounts_table` → `items_table` and filter by `user_id`.

### H3: MCP IDOR on mark-benefit-used
**File**: `prospify-mcp/src/tools/benefits.ts` lines 222-226  
`benefit_config_id` not validated to belong to a card owned by the authenticated user.  
**Fix**: Validate config ownership before inserting usage.

### H4: MCP ilike Wildcard Injection
**Files**: `prospify-mcp/src/tools/transactions.ts`, `benefits.ts`, `credits.ts`  
`%` and `_` in search params not escaped, allowing pattern probing.  
**Fix**: Escape `%` and `_` before interpolation.

### H5: MCP stdio Mode Non-Functional for Auth
**File**: `prospify-mcp/src/server.ts`  
Stdio mode starts but all tools fail since `session` is `undefined`.  
**Fix**: Implement env-var-based auth for stdio or document limitation.

### H6: Plaid createLinkToken IDOR (prospify-tools)
**File**: `src/server/api/routers/plaid.ts` line 13  
Accepts `userId` from client input without verifying `ctx.user.id`.  
**Fix**: Use `ctx.user.id` instead of `input.userId`.

### H7: Cards upsertCardDetails Missing Ownership (prospify-tools)
**File**: `src/server/api/routers/cards.ts` line 81  
No verification that the account IDs belong to the authenticated user.  
**Fix**: Verify account ownership before upserting.

### H8: Splitwise OAuth State Not Verified (prospify-tools)
**File**: `src/app/api/splitwise/callback/route.ts` line 56  
Random state token generated but never verified against stored value.  
**Fix**: Store state server-side and verify in callback.

### H9: No Rate Limiting (prospify-tools)
Zero rate limiting across the entire application.  
**Fix**: Add rate limiting middleware (e.g., `@upstash/ratelimit`).

### H10: Plaid Access Tokens Plaintext (infrastructure)
**File**: `prisma/schema.prisma` line 67  
`plaid_access_token` stored unencrypted.  
**Fix**: Encrypt at rest with AES-256-GCM.

### H11: Splitwise Access Tokens Plaintext (infrastructure)
**File**: `prisma/schema.prisma` line 265  
`access_token` stored unencrypted.  
**Fix**: Encrypt at rest with AES-256-GCM.

---

## MEDIUM Findings

| # | Issue | Location |
|---|-------|----------|
| M1 | MCP `.or()` string interpolation in PostgREST filters | `prospify-mcp/src/tools/profile.ts:60` |
| M2 | MCP DoS via `run-benefit-auto-match` (unbounded tx query) | `prospify-mcp/src/tools/benefits.ts:288` |
| M3 | MCP `confirm-credit-match` reads tx without user scope | `prospify-mcp/src/tools/credits.ts:102` |
| M4 | Splitwise token stored plaintext (webapp layer) | `src/app/api/splitwise/callback/route.ts:154` |
| M5 | Open redirect in Splitwise callback | `src/app/api/splitwise/callback/route.ts:186` |
| M6 | Benefit dashboard IDOR (accountId not verified) | `src/server/api/routers/benefits.ts:84` |
| M7 | Error messages leak internal details | All tool files |
| M8 | Prisma bypasses RLS (design choice) | `src/server/db.ts` |
| M9 | `merchant_metadata` overly permissive write policies | `setup-rls-policies.sql:193` |
| M10 | Cascade deletes could wipe financial history | `prisma/schema.prisma:32` |

---

## LOW Findings

| # | Issue | Location |
|---|-------|----------|
| L1 | MCP cache has no size limit | `prospify-mcp/src/auth.ts:22` |
| L2 | MCP no max length on string params | All tool files |
| L3 | MCP subscription fallback DoS | `prospify-mcp/src/tools/subscriptions.ts:33` |
| L4 | MCP Supabase errors exposed to clients | All tool files |
| L5 | Public catalog endpoints (no auth required) | `src/server/api/routers/cards.ts:15` |
| L6 | No CSRF tokens on API routes | Various |
| L7 | dangerouslySetInnerHTML (static content, low risk) | `src/components/ui/chart.tsx` |
| L8 | `card_benefit_configs` missing write restriction RLS | `setup-rls-policies.sql:1042` |

---

## Positive Findings

- All raw SQL in prospify-tools uses Prisma tagged template literals (auto-parameterized)
- RLS policies exist for 30+ tables, correctly scoped to `auth.uid()`
- tRPC `protectedProcedure` middleware properly checks auth
- Supabase SSR cookie handling is correct
- No secrets committed to git (.gitignore properly configured)
