# Prospify Security Audit Report

**Date**: 2026-04-07 (3 rounds completed)  
**Scope**: prospify-mcp (MCP server) + prospify-tools (web app) + infrastructure  
**Method**: Automated code review by 6 parallel security audit agents (2 rounds)

---

## Executive Summary

### Round 1

| Severity | MCP Server | Web App | Infrastructure | Total |
|----------|-----------|---------|---------------|-------|
| Critical | 1 (FIXED) | 2 | 1 | **4** |
| High | 5 (FIXED) | 4 | 2 | **11** |
| Medium | 3 (FIXED) | 5 | 2 | **10** |
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

---

## Round 2 Findings (2026-04-07, second pass)

### MCP Server — Verification Results

All round-1 fixes verified as working. Two minor gaps found and fixed:
- `escapeLikePattern` now escapes backslashes before `%`/`_` (prevents `\%` bypass)
- Missing `.max(500)` on `search-transactions-for-linking` search param added

### Web App — New Findings

#### R2-C1: Open Redirect via Splitwise OAuth State (HIGH)
**File**: `src/app/api/splitwise/callback/route.ts:57,86,117,130,147,186`  
The `redirect` query parameter is embedded in OAuth state and used directly in `NextResponse.redirect()` without validation.  
**Fix**: Validate redirectUrl starts with `/` and doesn't contain `://`.

#### R2-C2: Host Header Injection in Splitwise Callback (HIGH)
**File**: `src/app/api/splitwise/callback/route.ts:31,40,51,65,84`  
Redirect URLs constructed using `request.headers.get('host')` which is attacker-controlled.  
**Fix**: Use `process.env.NEXT_PUBLIC_SITE_URL` instead.

#### R2-C3: OAuth State Not Cryptographically Validated (HIGH)
**File**: `src/app/api/splitwise/auth/route.ts:38-42`  
Random state token generated but never stored or verified in callback.  
**Fix**: Store state in signed cookie, verify on callback.

#### R2-H1: IDOR in items.create — userId from Input (HIGH)
**File**: `src/server/api/routers/plaid/items.ts:63-71`  
Uses `input.userId` instead of `ctx.user.id`. User A can create items under User B.  
**Fix**: Use `ctx.user.id`.

#### R2-H2: IDOR in items.delete/getAccounts — No Ownership Check (HIGH)
**File**: `src/server/api/routers/plaid/items.ts:263-340`  
Item deletion and account listing have no user ownership verification.  
**Fix**: Add `user_id` filter.

#### R2-H3: IDOR in upsertCardDetails (HIGH)
**File**: `src/server/api/routers/cards.ts:81-99`  
No verification that account_id belongs to authenticated user.  
**Fix**: Verify ownership before upserting.

#### R2-M1: SSRF via Legacy Webhook Forwarder (MEDIUM)
**File**: `src/server/api/routers/plaid/services.ts:9-35`  
Public procedure with `z.any()` input forwards to webhook endpoint.  
**Fix**: Remove or add authentication.

#### R2-M2: Cross-User PII Leakage via Account Link Detection (MEDIUM)
**File**: `src/lib/account-linking.ts:209-237`  
Pending links expose other users' display names, emails, account masks.  
**Fix**: Limit PII exposure, require opt-in.

#### R2-M3: Splitwise Client No Timeout (MEDIUM)
**File**: `src/lib/splitwise-client.ts:148-185`  
`fetch()` has no timeout, enabling resource exhaustion.  
**Fix**: Add `AbortSignal.timeout(10000)`.

#### R2-M4: Splitwise Response Not Schema-Validated (MEDIUM)
**File**: `src/lib/splitwise-client.ts:181`  
API responses cast to TS types with no runtime validation.  
**Fix**: Validate with Zod schemas.

#### R2-L1: Race Condition in Account Link Role Selection (LOW)
**File**: `src/server/api/routers/linked-accounts.ts:306-390`  
Check-then-update not atomic — both users can set role simultaneously.  
**Fix**: Use atomic `UPDATE ... WHERE requires_role_selection = true RETURNING *`.

### Round 2 Summary

| Severity | Web App (new) | MCP Server (new) |
|----------|--------------|-----------------|
| High | 6 | 0 (fixes verified) |
| Medium | 4 | 0 (2 minor gaps fixed) |
| Low | 1 | 0 |

**Most urgent Round 2 fixes:**
1. Splitwise OAuth state validation (R2-C3) — enables CSRF account takeover
2. items.create/delete IDOR (R2-H1, R2-H2) — cross-user item manipulation
3. Host header injection (R2-C2) — redirect hijacking

### Round 3: Combined Attack Surface (2026-04-07, cross-system)

**MCP regression: 12/12 PASS** — all fixes verified.

#### R3 Fixes Applied to MCP:
- Category validation: regex `^[A-Z][A-Z0-9_]*$` prevents arbitrary string injection
- Benefit cap check: prevents reporting >2x the config amount per period
- Auth error: removed email from "no account found" message (prevents enumeration)

#### R3 Architectural Findings (documented, require design decisions):
- **HIGH**: Shared service role key — MCP compromise = full DB access. Create scoped key.
- **MEDIUM**: No concurrency control on shared tables (transaction_overrides, category_rules)
- **MEDIUM**: `listUsers()` pagination loads all users — switch to single-user lookup
- **LOW**: benefit_usages allows duplicate manual entries (NULL plaid_transaction_id)
- **LOW**: ReDoS risk from stored merchant patterns — consider `re2` library
