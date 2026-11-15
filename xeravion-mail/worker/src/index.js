/**
 * XERAVION MAIL - Cloudflare Worker starter
 *
 * Receives inbound messages via the Email Routing email() handler.
 * Raw RFC822 messages are stored in R2; searchable metadata lives in D1.
 *
 * Required bindings:
 * - env.DB: D1 database
 * - env.MAIL_RAW: R2 bucket
 *
 * This starter intentionally rejects unknown recipients. Create mailbox
 * rows through a future authenticated admin endpoint before enabling catch-all.
 */
export default {
  async email(message, env, ctx) {
    const recipient = String(message.to || "").trim().toLowerCase();
    const mailbox = await env.DB.prepare(
      "SELECT id, address FROM mailboxes WHERE address = ? AND is_active = 1"
    ).bind(recipient).first();

    if (!mailbox) {
      message.setReject("Unknown XERAVION mailbox");
      return;
    }

    const id = crypto.randomUUID();
    const key = `inbound/${mailbox.id}/${id}.eml`;
    const sender = String(message.from || "").slice(0, 320);

    // Preserve the original message for later MIME parsing and attachment extraction.
    await env.MAIL_RAW.put(key, message.raw, {
      httpMetadata: { contentType: "message/rfc822" },
      customMetadata: { mailboxId: mailbox.id, messageId: id }
    });

    await env.DB.prepare(
      `INSERT INTO messages
       (id, mailbox_id, sender, recipient, r2_key, raw_size)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, mailbox.id, sender, recipient, key, Number(message.rawSize || 0)).run();
  },

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "xeravion-mail", mode: "inbound-storage-starter" });
    }
    return new Response("Not found", { status: 404 });
  }
};
