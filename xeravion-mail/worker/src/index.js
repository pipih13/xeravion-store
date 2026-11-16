import PostalMime from "postal-mime";

const DOMAIN = "xeravion.my.id";
const MAX_EMAIL_BYTES = 20 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function cors(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = env.APP_ORIGIN;
  if (!origin || !allowed || origin !== allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "vary": "Origin"
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function extractOtp(text) {
  const source = String(text || "");
  const patterns = [
    /(?:verification|security|login|one[- ]time|otp|kode|code)[^\\d]{0,35}(\\d{4,8})/i,
    /\\b(\\d{6})\\b/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function safeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}@xeravion\\.my\\.id$/.test(address)) return null;
  return address;
}

async function adminAuthorized(request, env) {
  const supplied = bearer(request);
  if (!env.ADMIN_API_KEY || !supplied) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(env.ADMIN_API_KEY)]);
  return a === b;
}

async function resolveBuyer(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  return await env.DB.prepare(
    "SELECT id, address, mailbox_type FROM mailboxes WHERE access_token_hash = ? AND is_active = 1 AND mailbox_type = 'game_account'"
  ).bind(hash).first();
}

async function createMailbox(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  let address, gameCode = null, tokenHash = null;
  const id = crypto.randomUUID();
  if (body.type === "support") {
    address = "support@" + DOMAIN;
    const exists = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?").bind(address).first();
    if (exists) return json({ error: "Support mailbox already exists", address }, 409);
  } else {
    gameCode = String(body.game || "").toLowerCase();
    const prefixes = { ml: "akunml", ff: "akunff", pubg: "akunpubg" };
    if (!prefixes[gameCode]) return json({ error: "Game harus ml, ff, atau pubg" }, 400);
    const prefix = prefixes[gameCode];
    const rows = await env.DB.prepare(
      "SELECT address FROM mailboxes WHERE mailbox_type = 'game_account' AND game_code = ?"
    ).bind(gameCode).all();
    let max = 0;
    for (const row of rows.results || []) {
      const match = row.address.match(new RegExp("^" + prefix + "(\\d{3,})@"));
      if (match) max = Math.max(max, Number(match[1]));
    }
    address = prefix + String(max + 1).padStart(3, "0") + "@" + DOMAIN;
  }

  let accessToken = null;
  if (gameCode) {
    accessToken = randomToken();
    tokenHash = await sha256(accessToken);
  }
  await env.DB.prepare(
    "INSERT INTO mailboxes (id,address,mailbox_type,game_code,access_token_hash) VALUES (?,?,?,?,?)"
  ).bind(id, address, gameCode ? "game_account" : "support", gameCode, tokenHash).run();

  // Buyer token is shown once only. Support is accessed exclusively through admin endpoints.
  return json({ ok: true, address, accessToken, note: accessToken ? "Simpan token ini; token tidak dapat ditampilkan lagi." : "Inbox support hanya dapat diakses admin." }, 201);
}

async function listMailboxes(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const result = await env.DB.prepare(
    "SELECT id,address,mailbox_type,game_code,is_active,created_at FROM mailboxes ORDER BY created_at DESC"
  ).all();
  return json({ mailboxes: result.results || [] });
}

async function listMessages(mailbox, env, url) {
  const q = String(url.searchParams.get("q") || "").slice(0, 100);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100);
  const rows = await env.DB.prepare(
    `SELECT id,sender,recipient,subject,received_at,is_read,otp_code
     FROM messages WHERE mailbox_id = ?
     AND (? = '' OR sender LIKE '%' || ? || '%' OR subject LIKE '%' || ? || '%' OR body_text LIKE '%' || ? || '%')
     ORDER BY received_at DESC LIMIT ?`
  ).bind(mailbox.id, q, q, q, q, limit).all();
  return json({ address: mailbox.address, messages: rows.results || [] });
}

async function readMessage(mailboxId, messageId, env) {
  const row = await env.DB.prepare(
    "SELECT id,sender,recipient,subject,body_text,otp_code,received_at,is_read,attachments_json FROM messages WHERE id = ? AND mailbox_id = ?"
  ).bind(messageId, mailboxId).first();
  if (!row) return json({ error: "Email tidak ditemukan" }, 404);
  await env.DB.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").bind(messageId).run();
  let attachments = [];
  try { attachments = JSON.parse(row.attachments_json || "[]").map(({name,contentType,size,id}) => ({name,contentType,size,id})); } catch {}
  return json({ ...row, attachments });
}

async function adminMailboxByAddress(request, env, address) {
  if (!(await adminAuthorized(request, env))) return null;
  return await env.DB.prepare("SELECT id,address,mailbox_type FROM mailboxes WHERE address = ? AND is_active = 1").bind(address).first();
}

async function storeIncoming(message, env) {
  const recipient = safeAddress(message.to);
  if (!recipient) {
    message.setReject("Invalid XERAVION recipient");
    return;
  }
  const mailbox = await env.DB.prepare(
    "SELECT id,address FROM mailboxes WHERE address = ? AND is_active = 1"
  ).bind(recipient).first();
  if (!mailbox) {
    message.setReject("Unknown XERAVION mailbox");
    return;
  }
  if (Number(message.rawSize || 0) > MAX_EMAIL_BYTES) {
    message.setReject("Message exceeds XERAVION size limit");
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  if (raw.byteLength > MAX_EMAIL_BYTES) {
    message.setReject("Message exceeds XERAVION size limit");
    return;
  }
  const parsed = await PostalMime.parse(raw);
  const id = crypto.randomUUID();
  const key = "inbound/" + mailbox.id + "/" + id + ".eml";
  const attachments = [];

  await env.MAIL_RAW.put(key, raw, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { mailboxId: mailbox.id, messageId: id }
  });

  for (const attachment of parsed.attachments || []) {
    const attachmentId = crypto.randomUUID();
    const attachmentKey = "attachments/" + mailbox.id + "/" + id + "/" + attachmentId;
    const content = attachment.content;
    await env.MAIL_RAW.put(attachmentKey, content, {
      httpMetadata: { contentType: attachment.mimeType || "application/octet-stream" }
    });
    attachments.push({
      id: attachmentId,
      key: attachmentKey,
      name: String(attachment.filename || "attachment").slice(0, 180),
      contentType: String(attachment.mimeType || "application/octet-stream").slice(0, 120),
      size: content.byteLength
    });
  }

  const bodyText = String(parsed.text || "").slice(0, 200000);
  const subject = String(parsed.subject || message.headers.get("subject") || "").slice(0, 998);
  const sender = String(parsed.from?.address || message.from || "").slice(0, 320);
  await env.DB.prepare(
    `INSERT INTO messages (id,mailbox_id,sender,recipient,subject,body_text,otp_code,r2_key,raw_size,attachments_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, mailbox.id, sender, recipient, subject, bodyText, extractOtp(subject + "\\n" + bodyText), key, raw.byteLength, JSON.stringify(attachments)).run();
}

async function attachmentResponse(mailboxId, messageId, attachmentId, env) {
  const row = await env.DB.prepare("SELECT attachments_json FROM messages WHERE id = ? AND mailbox_id = ?").bind(messageId, mailboxId).first();
  if (!row) return new Response("Not found", { status: 404 });
  let items = [];
  try { items = JSON.parse(row.attachments_json || "[]"); } catch {}
  const item = items.find(x => x.id === attachmentId);
  if (!item) return new Response("Not found", { status: 404 });
  const object = await env.MAIL_RAW.get(item.key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": item.contentType || "application/octet-stream",
      "content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(item.name),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async email(message, env) {
    try { await storeIncoming(message, env); }
    catch (error) {
      console.error("XERAVION inbound processing failed", error);
      message.setReject("XERAVION could not store this message");
    }
  },

  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    let response;

    if (url.pathname === "/health" && request.method === "GET") {
      response = json({ ok: true, service: "xeravion-mail", status: "worker-online" });
    } else if (url.pathname === "/admin/mailboxes" && request.method === "POST") {
      response = await createMailbox(request, env);
    } else if (url.pathname === "/admin/mailboxes" && request.method === "GET") {
      response = await listMailboxes(request, env);
    } else if (url.pathname === "/admin/messages" && request.method === "GET") {
      if (!(await adminAuthorized(request, env))) response = json({ error: "Unauthorized" }, 401);
      else {
        const address = safeAddress(url.searchParams.get("address"));
        const mailbox = address ? await env.DB.prepare("SELECT id,address FROM mailboxes WHERE address = ? AND is_active = 1").bind(address).first() : null;
        response = mailbox ? await listMessages(mailbox, env, url) : json({ error: "Mailbox not found" }, 404);
      }
    } else if (url.pathname.startsWith("/admin/messages/") && request.method === "GET") {
      if (!(await adminAuthorized(request, env))) response = json({ error: "Unauthorized" }, 401);
      else {
        const address = safeAddress(url.searchParams.get("address"));
        const mailbox = address ? await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ? AND is_active = 1").bind(address).first() : null;
        response = mailbox ? await readMessage(mailbox.id, url.pathname.split("/").pop(), env) : json({ error: "Mailbox not found" }, 404);
      }
    } else if (url.pathname === "/api/messages" && request.method === "GET") {
      const mailbox = await resolveBuyer(request, env);
      response = mailbox ? await listMessages(mailbox, env, url) : json({ error: "Unauthorized" }, 401);
    } else if (url.pathname.startsWith("/api/messages/") && request.method === "GET") {
      const mailbox = await resolveBuyer(request, env);
      response = mailbox ? await readMessage(mailbox.id, url.pathname.split("/").pop(), env) : json({ error: "Unauthorized" }, 401);
    } else if (url.pathname.startsWith("/api/attachments/") && request.method === "GET") {
      const mailbox = await resolveBuyer(request, env);
      const parts = url.pathname.split("/");
      response = mailbox ? await attachmentResponse(mailbox.id, parts[3], parts[4], env) : new Response("Unauthorized", { status: 401 });
    } else {
      response = json({ error: "Not found" }, 404);
    }

    const merged = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) merged.set(key, value);
    return new Response(response.body, { status: response.status, headers: merged });
  }
};
