# XERAVION MAIL

A separate inbox application for XERAVION.

## Product decisions
- Clean, Gmail-like inbox. No game-specific sections or game lists.
- Address format: `name@xeravion.my.id`.
- Existing store stays at repository root; mail app is isolated in `xeravion-mail/`.
- Admin management and buyer-specific mailbox access must be enforced server-side.

## Current status
- `index.html`: static UI prototype only.
- `worker/src/index.js`: inbound storage starter, not deployed.
- `worker/schema.sql`: initial D1 schema.
- Not production-ready: no MIME parser, OTP extraction, admin login, mailbox token API, message-reading API, attachment UI, rate limits, or live provider test yet.

## DNS and provider architecture
Cloudflare Email Routing/Email Workers requires the relevant domain zone to be active on Cloudflare. For addresses at the apex `@xeravion.my.id`, the apex MX records must point to the receiving service. Since the authoritative nameservers are currently IDCloudHost (`elang.ns.dnscloud.id`, `fajar.ns.dnscloud.id`), Cloudflare Email Routing cannot simply be enabled by adding an MX record while leaving the zone hosted at IDCloudHost.

Possible safe route: move authoritative DNS for the zone to Cloudflare only after exporting and verifying every existing DNS record from IDCloudHost, including Netlify apex A and www CNAME, TXT verification, and any service records. Keep Netlify records DNS-only where appropriate and verify the site before adding MX. Changing nameservers without a complete copy can interrupt the store.

No nameserver or MX changes have been made by this repository work. Do not publish DNS changes until the complete current IDCloudHost zone is captured and compared.

## Worker bindings
- D1 binding: `DB`
- R2 binding: `MAIL_RAW`
- Email handler: enable Email Routing and route the intended recipient domain to this Worker only after DNS activation.

Apply `worker/schema.sql` to D1 before deploying the Worker. Do not expose service tokens in browser code.

## Security and production requirements
- Generate high-entropy per-mailbox access tokens and store only hashes.
- Admin endpoints require a separate secret and must be rate limited.
- Every message and attachment read must verify mailbox ownership.
- Validate recipient domain and mailbox status.
- Add MIME parsing with size limits and safe attachment handling.
- Test deliverability with real messages before claiming support for any game provider.
