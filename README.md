# Post

Post puts multiple Gmail and Google Workspace accounts in one inbox. It reads and changes real Gmail data through Google's API. There is no demo mode and no provider abstraction.

## What it does

- Connects multiple Google accounts with OAuth 2.0.
- Combines inbox, archive, sent, drafts, trash, and spam mail.
- Keeps Gmail's Primary, Promotions, Social, Updates, and Forums categories.
- Archives, restores, trashes, marks read or unread, and stars Gmail threads.
- Composes new messages and sends replies or reply-all messages from the selected account.
- Saves drafts to both Post and Gmail.
- Renders sanitized MIME HTML inside an isolated iframe.
- Searches the loaded mailbox by sender, recipient, subject, and body.

## Stack

- React 19, TypeScript, and Vite
- Express
- PostgreSQL on Supabase
- Gmail API and Google OAuth 2.0
- Zod for request and persisted-data validation
- Vitest

## Requirements

- Node.js 22 or newer
- A Supabase PostgreSQL project
- A Google Cloud project with the Gmail API enabled
- A Google OAuth web client

## Set up Google OAuth

Create a web OAuth client in Google Cloud. Add this authorized redirect URI for local development:

```text
http://localhost:4173/api/oauth/google/callback
```

The OAuth consent screen must request the scopes declared in `server/gmail.ts`. Test-mode Google applications also need each Gmail account on the OAuth test-user list.

## Configure the application

Install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env
```

Download the Supabase database CA certificate and save it as `supabase-ca.crt`, or change `SUPABASE_DB_CA_CERT_PATH` to its location. Post verifies the database certificate and does not accept an unverified TLS connection.

Set these values in `.env`:

| Variable | Purpose |
| --- | --- |
| `APP_BASE_URL` | Browser origin, normally `http://localhost:4173` |
| `DATABASE_URL` | PostgreSQL connection string for the Supabase project |
| `SUPABASE_DB_CA_CERT_PATH` | Path to the Supabase CA certificate |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | OAuth callback URL |
| `SESSION_SECRET` | Secret used to sign OAuth state, at least 32 characters |
| `TOKEN_ENCRYPTION_KEY` | Secret used to encrypt Google credentials, at least 32 characters |
| `API_PORT` | Express port, defaults to `4174` |

Generate independent secrets for `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Do not commit `.env` or the database certificate. Both paths are ignored by Git.

## Run Post

Start the Vite and Express development servers:

```bash
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The Express server applies `server/schema.sql` during startup. The Vite server proxies `/api` requests to port `4174`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the API and web development servers |
| `npm test` | Run the focused test suite |
| `npm run build` | Type-check both applications and build the web client |
| `npm run preview` | Run the production API and Vite preview server |
| `npm run mail:cache:resume` | Sync recent mail and advance historical metadata by one page per account |
| `npm run mail:cache:reset` | Rebuild the Gmail-derived message cache and reclaim its storage |

`mail:cache:reset` truncates Post's derived `mail_messages` cache. It does not delete Gmail messages. The command keeps thread records, syncs recent content again, and resumes metadata backfill.

## Mail storage

Gmail remains the source of truth. Post stores thread and message metadata in PostgreSQL, but it does not copy every historical MIME body into the database.

Recent and opened message bodies use a 64 MiB cache per application user. Opening a cold thread fetches its full content from Gmail. Historical backfill requests Gmail's metadata format and preserves any body already in the cache. Backfill progress persists across the `mail`, `spam`, `trash`, and `complete` stages.

OAuth access and refresh tokens use AES-256-GCM encryption before they reach PostgreSQL. Browser sessions use an HttpOnly cookie. PostgreSQL row-level security is enabled, and browser-facing Supabase roles have no direct table access.

## Current limits

- New mail appears after a manual account sync. Post does not yet consume Gmail push notifications or the History API.
- The mailbox response contains the latest 500 stored threads. Search runs over that loaded set.
- The project has no provider support beyond Gmail and Google Workspace.
