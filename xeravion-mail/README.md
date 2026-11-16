# XERAVION MAIL

A separate inbox application for XERAVION.

## Confirmed product decisions
- Clean, Gmail-like inbox. No game-specific sections or game lists in the buyer inbox.
- Address format stays on the main domain: `name@xeravion.my.id`.
- Official support address: `support@xeravion.my.id`, admin-only.
- Game account address patterns:
  - Mobile Legends: `akunml001@xeravion.my.id`, then incrementing numbers.
  - Free Fire: `akunff001@xeravion.my.id`, then incrementing numbers.
  - PUBG Mobile: `akunpubg001@xeravion.my.id`, then incrementing numbers.
- Admin can create, disable, and assign mailbox access. Buyers only access the mailbox explicitly assigned to their purchase.
- Existing store stays at repository root and must not be modified by this app.

## Current status
- `index.html`: static Gmail-like UI prototype only.
- `worker/src/index.js`: inbound storage starter, not deployed.
- `worker/schema.sql`: initial D1 schema with admin-only mailbox metadata for support/game accounts.
- Not production-ready: no MIME parser, OTP extraction, admin login, mailbox token API, message-reading API, attachment UI, rate limits, or live provider test yet.

## DNS and provider architecture
Verified from the user's IDCloudHost DNS screenshot (3 records total):
- CNAME `@` -> `xeravion-store.pages.dev` (Cloudflare Pages apex; CNAME flattening)
- CNAME `www` -> `xeravion-store.pages.dev` (Cloudflare Pages www)
- NS `@` -> `elang.ns.dnscloud.id`, `fajar.ns.dnscloud.id` (current authoritative nameservers shown by IDCloudHost)
- No MX, TXT, or other record is shown in the screenshot's complete 3-record list.

The user has clarified that the production website is now hosted on Cloudflare Pages, not Netlify. Current Cloudflare DNS screenshot shows the Pages CNAMEs above and a Google site-verification TXT record at `@` (preserve its exact value). Cloudflare nameservers assigned to the zone are `carlane.ns.cloudflare.com` and `seth.ns.cloudflare.com`; the user showed the same pair entered in IDCloudHost's custom nameserver form. Do not revert records to the historical Netlify targets. Preserve the current Pages CNAMEs and Google TXT record while configuring email. Confirm the zone status is Active before adding mail records.

Cloudflare Email Service requires Cloudflare DNS. It cannot be enabled simply by adding its MX records while keeping the domain's authoritative DNS hosted at IDCloudHost. A nameserver move is not authorized until every existing DNS record has been captured, copied, and checked against the live Netlify website.

Potential alternative: use an inbound-email provider that accepts a custom MX record while leaving authoritative DNS at IDCloudHost. Provider must be checked for:
- apex-domain support for `@xeravion.my.id` (not just a subdomain),
- catch-all/dynamic recipients,
- inbound webhook/API and raw message access,
- price/credits and retention,
- attachment support and retries,
- ability to distinguish each recipient address.

Do not select or configure a provider based on a free-tier headline alone. Test actual delivery and check its usage limits first. Do not change MX until the provider and full DNS zone are confirmed.

## Worker bindings
- D1 binding: `DB`
- R2 binding: `MAIL_RAW`
- Email handler: connect only after an inbound provider is selected and DNS records are safely configured.

Apply `worker/schema.sql` to D1 before deploying the Worker. Do not expose service tokens in browser code.

## Security and production requirements
- Generate high-entropy per-mailbox access tokens and store only hashes.
- Admin endpoints require a separate secret and must be rate limited.
- The support mailbox is admin-only and must never receive a buyer access token.
- Every message and attachment read must verify mailbox ownership.
- Validate recipient domain and mailbox status.
- Add MIME parsing with size limits and safe attachment handling.
- Test delivery from actual game-provider senders before claiming support for any game.


## Cloudflare DNS onboarding screenshot review (2026-11-17)
Cloudflare currently shows exactly 3 records:
- CNAME `www` -> `xeravion-store.pages.dev` (proxied)
- CNAME `@` -> `xeravion-store.pages.dev` (proxied)
- TXT `@` -> Google site verification token (DNS only; full token is not legible in screenshot; preserve it exactly)

Historical note: an older IDCloudHost screenshot showed Netlify records before the user migrated the website to Cloudflare Pages. Those historical Netlify values are obsolete and must not be restored.


## Domain activation status (user screenshot, 2026-11-17)
Cloudflare Overview displays: "Your domain is now protected by Cloudflare". Treat the zone as active/proxied at Cloudflare. User confirmed the site is hosted on Cloudflare Pages at `xeravion-store.pages.dev`; do not restore historical Netlify records.

Do not onboard Email Routing / add root MX records until the Worker has been deployed, D1 and R2 bindings are ready, and a catch-all Worker rule can be enabled immediately. Cloudflare documents that messages with no matching rule and no active catch-all are rejected; after MX activation, configure routing rules promptly. The next engineering milestone is to finish and deploy a secure receiving Worker and inbox API, then onboard Email Routing and test delivery.


## Worker implementation milestone (2026-11-17)
The Worker code currently committed includes:
- inbound `email()` handler that checks known active recipient mailboxes;
- MIME parsing with PostalMime;
- raw message and attachment storage in R2;
- sender, recipient, subject, plain-text body, received time, read status and best-effort OTP extraction in D1;
- admin-only mailbox creation/listing and support mailbox access;
- buyer mailbox access using a one-time-issued bearer token (only its hash is stored);
- mailbox-scoped message and attachment reads;
- 20 MiB inbound size guard.

Important limitations before production:
- Code is committed but NOT deployed; no D1 database, R2 bucket, Worker secret, or email route has been created yet.
- OTP extraction is heuristic and must be tested against real game emails. It is not guaranteed to find every code.
- HTML email rendering is intentionally not enabled yet; plain-text body only.
- No UI login/admin panel or buyer token delivery integration exists yet.
- Add rate limiting, token revocation/rotation, audit logs, spam/abuse controls, retention policy and robust MIME/attachment testing before public launch.
- The support mailbox is admin-only at API level; do not expose its API key in the browser.

## Deployment configuration
Worker folder: `xeravion-mail/worker`.
- Install dependencies with `npm install`.
- Create D1 database named `xeravion-mail-db` and paste its real database ID into `wrangler.toml`.
- Create R2 bucket named `xeravion-mail`.
- Apply `schema.sql` to the remote D1 database.
- Set secret `ADMIN_API_KEY` using Wrangler secret storage; never commit it.
- Set `APP_ORIGIN` to the exact final inbox website origin before enabling browser access.
- Deploy Worker and test `/health`, admin authorization, mailbox creation, and inbox APIs.
- Only then configure Email Routing MX and a catch-all route to this Worker.


## Cost-conscious MVP decision (2026-11-17)
R2 activation is deferred. The first release is D1-only:
- store parsed sender, recipient, subject, plain-text body, OTP candidate and received time in D1;
- do not retain raw MIME or attachment contents;
- attachment endpoints return HTTP 501 until R2 is deliberately enabled;
- no R2 bucket or R2 billing activation is required for this MVP.
The existing D1 schema has a NOT NULL `r2_key` field, so D1-only messages use a unique `d1-only/<message-id>` marker. This is an internal placeholder, not a real R2 object key.
Enable R2 later only if the user explicitly wants attachments/raw email archival and accepts usage-based billing.
