# Gelir Gider Paneli (showcase)

A single-user personal finance dashboard with a Telegram bot that reads receipt photos. It tracks income, expenses and balances across EUR and TRY accounts. Data comes in through Telegram, an Apple Pay Shortcut, a Gmail bridge and PDF bank statements, and every source feeds the same deduplicated ledger.

This is a sanitized copy of a private project I use every day. The UI is in Turkish (with partial English). All bank names, statement formats, amounts and merchants in the code and tests have been replaced with fictional ones ("Anka Bank", "Lale Bank", "Contoso Bank", the "Fabrikam" blocked account, `DEMO SHOP`, and so on).

## Features

- **Dashboard**: monthly income and expenses, net worth in EUR and TRY, budgets, savings goals, upcoming fixed expenses and charts. Each transaction stores the ECB exchange rate for its own date (via frankfurter).
- **Telegram bot**:
  - Quick entries such as `45 market`, `12.5 eur coffee @card` and `+1200 try freelance`, plus `/bakiye` (balances) and `/ozet` (summary).
  - Send a receipt photo or PDF: Gemini (with Groq as fallback) extracts the merchant, date, total, category and every line item.
  - Inline "paid" buttons for recurring bills.
  - Approval flow for bank statements that arrive by email.
- **Grocery intelligence**:
  - Line items are normalized: product, brand, pack size and price per kg or litre.
  - Each item is rated cheap, fair or expensive against your own price history (median).
  - Product photos are looked up from store sites and Open Food Facts.
  - Supermarket flyer deals are shown for products you buy.
- **Statement import (PDF)**:
  - Parsers for card, debit and account statements.
  - Each statement is validated before anything is written: totals, row counts and the running-balance chain must all match.
  - Re-importing a statement never duplicates rows.
  - Transactions already entered through Apple Pay or Telegram are matched and flagged instead of added again.
- **Automation**:
  - An Apple Pay Shortcut webhook.
  - A Gmail Apps Script bridge for bank notification emails and statement PDFs.
  - Vercel Cron jobs: daily FX rates, recurring transactions and reminders; a weekly summary and a JSON backup to storage.
- **Customization**: rules for auto-categorizing, recurring transactions, categories, accounts with match keywords, bulk edits, CSV export and a full JSON backup.
- **Demo mode**: a cookie switches the Supabase client to an in-memory fake (`src/lib/demo/`), so the UI can be shown without real data.

## Stack

Next.js 16 (App Router, server actions, `proxy.ts`), React 19, TypeScript, Tailwind CSS 4 with shadcn/Base UI components, Recharts, Supabase (Postgres, Auth, Storage, RLS), Zod, unpdf, Vitest. It is deployed on Vercel (serverless and Cron).

## Architecture

```
Telegram ──webhook (secret token)──┐
Apple Pay Shortcut ──Bearer────────┤
Gmail Apps Script ──Bearer─────────┼──> Next.js route handlers ──> Supabase (service role, owner-scoped)
Vercel Cron ──Bearer───────────────┘
Browser ──session + OWNER_EMAIL (proxy.ts)──> pages / server actions ──> Supabase (anon key + RLS)
```

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Engineering points:

- **One owner, enforced twice.** `src/proxy.ts` rejects any session whose email is not `OWNER_EMAIL`, and every table has RLS with `user_id = auth.uid()`. Machine-to-machine routes are the only ones outside the proxy, and each checks its own secret with a timing-safe comparison that fails closed when the secret is unset.
- **Custom login code.**
  - A 6-digit code is stored only as an HMAC in the owner's `app_metadata`.
  - Codes expire after 10 minutes and allow 5 tries.
  - Issuing is limited to once every 45 seconds and to 6 codes per hour.
  - The session is opened with a Supabase `token_hash`.
- **Atomic multi-step writes.** Inserting a transaction together with its receipt items, or applying a whole statement, runs in a single Postgres function (migrations `0008` and `0009`). Functions that only the service role should call have `EXECUTE` revoked from `anon` and `authenticated`.
- **Self-validating parsers.** A statement that does not reconcile is rejected as a whole instead of being partially imported.
- **Resilient OCR.**
  - Gemini calls retry on 5xx and switch to fallback models on 429 or 503, within a time budget that fits the serverless limit. Groq is the alternative provider.
  - Model output is validated with Zod.
  - The sum of the line items is checked against the receipt total.
- **Security headers.**
  - A strict CSP: `connect-src 'self'`, `frame-ancestors 'none'`.
  - HSTS and nosniff.
  - CSV export guards against formula injection.
  - URLs from outside sources are limited to http(s) before they are rendered.

## Getting started

Requirements: Node 20+ and a Supabase project.

1. In Supabase:
   - Run the SQL files in `supabase/migrations/` in order.
   - Keep the Email provider enabled and turn off "Allow new users to sign up".
   - Add your user under Authentication > Users and add `<APP_URL>/auth/callback` to the redirect URLs.
2. Copy `.env.example` to `.env.local` and fill it in. Every value in the example is a placeholder.
3. Install and run:

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest
npm run lint
npm run typecheck  # next typegen && tsc --noEmit
npm run build
```

Optional integrations:

- **Telegram**: create a bot with BotFather and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
  - Register the webhook from the Integrations page; it uses `APP_URL`.
  - Then send `/start` to the bot to get your chat id.
- **Receipt OCR**: set `GEMINI_API_KEY`, or `GROQ_API_KEY` as the alternative.
- **Apple Pay**: in iOS Shortcuts, create an automation that POSTs `{amount, merchant, card}` to `/api/ingest` with `Authorization: Bearer <INGEST_SECRET>`.
- **Gmail bridge**: copy the Apps Script shown on the Integrations page into script.google.com.

## Tests

Running `npm test` gives **18 test files and 194 tests, all passing**. They cover:

- statement parsers and reconciliation
- email parsing
- quick-entry and amount parsing (TR, DE and US number formats)
- deduplication and merge logic
- dashboard math
- price verdicts
- product matching
- pagination
- atomic RPC fallbacks
- the URL and secret helpers

All fixtures are synthetic.

## Project status

The private original is in daily use by one person. This showcase is not deployed, and it was built from the original's committed history only, with fresh git history. Known limitations:

- It is single-user by design.
- The parsers target specific (here renamed) bank layouts.
- Free-tier OCR quotas are low.
- Three `npm audit` advisories remain in the dev-only Vitest toolchain, and fixing them would require a major Vitest upgrade.

## How this was built

I built this project with AI coding assistants, mainly Claude Code with Codex as a reviewer. I set the requirements, made the product and architecture decisions, tested the app on my own data and reviewed the changes. The assistants wrote most of the code. The security review and sanitization of this showcase were also done with Claude Code under my direction.

## License

MIT, see [LICENSE](LICENSE).
