# XERAVION MAIL

A separate inbox application for the XERAVION brand.

## Product decisions
- Inbox should look and feel like a clean, familiar email client.
- No game-specific sections or game lists in the inbox.
- Target email address format: `name@xeravion.my.id`.
- Admin address management and buyer-specific inbox access will be separate from the inbox UI.
- The existing XERAVION store remains at the repository root and must not be modified by this app.

## Current status
- `index.html` is a static UI prototype only.
- It does not receive, store, or send real email yet.
- Search, folders, compose, and refresh controls are intentionally disabled until the authenticated backend is connected.

## Important DNS / email architecture constraint
The apex address format `@xeravion.my.id` requires the inbound mail provider's MX records on the apex domain. Adding or replacing MX records affects email delivery, not the Netlify website's HTTP A/CNAME records, but it can interrupt any existing mailbox service on the domain. Do not change MX records until the current DNS zone and any existing email service have been checked.

Cloudflare Email Routing currently requires Cloudflare DNS for the domain. Since the current nameservers remain at IDCloudHost, do not promise Cloudflare Email Routing without moving DNS or using a different inbound mail provider. A provider-neutral inbound webhook can be used with a compatible email receiving service.

## Planned implementation
1. Confirm the complete current DNS zone and whether any MX records/mailboxes already exist.
2. Choose an inbound email provider that supports catch-all or dynamic recipients and inbound webhooks.
3. Build authenticated backend storage for messages and attachments, with per-address access controls.
4. Add admin address management and buyer-specific access tokens.
5. Connect the inbox UI, then test real messages from supported game providers before production claims.

## Safety
Never expose service secrets in frontend code. Enforce authorization server-side for every mailbox and attachment request.
