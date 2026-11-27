# Architecture

## Layout

| Path | Purpose |
| --- | --- |
| `src/proxy.ts` | Next.js 16 proxy (formerly middleware). It requires a Supabase session whose email equals `OWNER_EMAIL`. The only public paths are `/login`, `/auth/*`, the webhook and cron routes, and the PWA icons. |
| `src/app/(app)/*` | Authenticated pages: dashboard, transactions, accounts, budgets, goals, recurring, rules, groceries, deals, import, integrations, notifications, settings. Writes go through server actions. |
| `src/app/api/telegram` | Telegram webhook. It checks `x-telegram-bot-api-secret-token` with a timing-safe compare and ignores every chat except `TELEGRAM_CHAT_ID`. |
| `src/app/api/ingest/*` | Apple Pay Shortcut (`/api/ingest`), Gmail bridge emails (`/email`) and statement PDFs (`/statement`). All require `Authorization: Bearer <INGEST_SECRET>`. |
| `src/app/api/cron/*` | Daily job (FX rates, recurring transactions, reminders, health checks) and weekly job (summary, JSON backup to storage). Both require `Authorization: Bearer <CRON_SECRET>`. |
| `src/app/api/product`, `deals`, `export/*` | Called by the browser. They require a session and run with RLS. |
| `src/lib/receipt.ts`, `receipt-flow.ts` | Receipt OCR (Gemini with model fallback, or Groq), Zod validation, deduplication by Telegram file id, and matching a receipt to an existing Apple Pay transaction. |
| `src/lib/statements/*` | PDF statement parsers. They are pure functions and covered by tests, and they produce rows with stable `externalId`s for idempotent import. |
| `src/lib/demo/*` | Demo mode: a fake `fetch` that answers Supabase REST calls from generated in-memory data. |
| `supabase/migrations/*` | Schema, RLS policies, storage policy, and RPCs for atomic multi-step writes. |

## Data access

- **Browser and server actions** use the anon key plus the user's session. Every table has an `owner_all` RLS policy (`user_id = auth.uid()`). FX rates can be read by any authenticated user.
- **Webhooks and cron** have no user session, so they use the service-role client (`src/lib/supabase/admin.ts`). Each query is explicitly scoped to `OWNER_USER_ID`. These routes are reachable only with their secret.
- **RPCs** that should be called only by the service role (`insert_telegram_receipt`, `attach_telegram_receipt`, `finish_telegram_statement`) have `EXECUTE` revoked from `public`, `anon` and `authenticated`.

## Idempotency and deduplication

- Each source writes a stable `external_id`:
  - `tg:` / `tgh:` for Telegram files
  - parser-specific prefixes for statement rows
  - the bank's query number (or the message id) for notification emails
- Re-delivering the same item is a no-op.
- When a statement is imported, rows that were already entered through Apple Pay, Telegram or by hand are matched by date window, amount and merchant tokens (`src/lib/merge.ts`). They are flagged instead of inserted.
- After a statement is applied, the opening balance is reconciled to the statement's closing balance, and every change is written to an audit log (`0008`).

## Login

- When Resend is configured, the app issues its own 6-digit code (`src/lib/login-code.ts`):
  - It stores an HMAC of the code in the owner's `app_metadata`.
  - Codes expire after 10 minutes and allow 5 wrong tries.
  - A new code can be issued at most once every 45 seconds and 6 times per hour.
  - A valid code opens the session through `auth.admin.generateLink` and then `verifyOtp(token_hash)`.
- Without Resend, the app falls back to Supabase's own email OTP.
- The response does not reveal whether an email is the owner's.

## Security notes

- CSP allows connections only to the app's own origin (`connect-src 'self'`) and blocks framing. HSTS and nosniff are set.
- `script-src` still needs `'unsafe-inline'` for Next.js. Because of that, URLs from outside sources (Open Food Facts, a product link the user picked) are limited to `http(s)` before they are stored or rendered.
- The Telegram webhook URL comes from `APP_URL`, never from the request's `Host` header.
- CSV export prefixes cells that start with `= + - @` so spreadsheets do not run them as formulas.
- Free-text search is stripped of PostgREST filter metacharacters before it reaches `.or()`.
