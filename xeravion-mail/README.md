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
- A `@` -> `75.2.60.5` (Netlify apex)
- CNAME `www` -> `lucky-sorbet-57e2c8.netlify.app` (Netlify www)
- NS `@` -> `elang.ns.dnscloud.id`, `fajar.ns.dnscloud.id` (current authoritative nameservers shown by IDCloudHost)
- No MX, TXT, or other record is shown in the screenshot's complete 3-record list.

The domain currently uses IDCloudHost nameservers. No DNS or nameserver changes have been made by this repository work. Preserve the apex A and www CNAME exactly during any migration. Do not manually copy the old authoritative NS record as a replacement for Cloudflare's assigned nameservers; Cloudflare assigns its own authoritative nameservers when the zone is activated. Verify the registrar's nameserver screen before any switch.

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
