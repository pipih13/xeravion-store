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
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
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

function htmlToReadableText(html) {
  let value = String(html || "");
  value = value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|td|th|li|h[1-6]|blockquote|pre)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, " ");
  return value.replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>{const c=Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):"";}).replace(/&#x([0-9a-f]+);/gi,(_,n)=>{const c=parseInt(n,16);return c>0&&c<=0x10ffff?String.fromCodePoint(c):"";}).replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n").replace(/\n{3,}/g,"\n\n").replace(/[ \t]{2,}/g," ").trim();
}

function extractOtp(text) {
  const source = String(text || "").replace(/\u00a0/g, " ");
  const codeLabel = /(?:verification|verify|security|login|sign[ -]?in|one[- ]time|passcode|otp|kode|verifikasi|keamanan|masuk|konfirmasi|confirmation|authentication|authentikasi).{0,45}(?:code|kode|password|passcode|otp)?|(?:code|kode|password|passcode|otp).{0,35}(?:verification|verify|security|login|sign[ -]?in|one[- ]time|verifikasi|keamanan|masuk|konfirmasi)?/i;
  const accountLabel = /account\s*(?:id|number)|user\s*id|player\s*id|character\s*id|id\s*(?:akun|account|pengguna|pemain)|nomor\s*akun/i;
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  // Prefer a code on the same line as an explicit login/verification label.
  // Never treat a number on an account-ID line as the login code.
  for (const line of lines) {
    if (accountLabel.test(line) || !codeLabel.test(line)) continue;
    const match = line.match(/\b(\d{4,8})\b/);
    if (match) return match[1];
  }

  // Some providers put the label and number on adjacent lines.
  for (let i = 0; i < lines.length; i++) {
    if (accountLabel.test(lines[i]) || !codeLabel.test(lines[i])) continue;
    const sameLine = lines[i].match(/\b(\d{4,8})\b/);
    if (sameLine) return sameLine[1];
    const next = lines[i + 1] || "";
    if (!accountLabel.test(next)) {
      const nextNumber = next.match(/\b(\d{4,8})\b/);
      if (nextNumber) return nextNumber[1];
    }
  }

  // Safe fallback only when exactly one six-digit number exists and the
  // message explicitly refers to account access or verification.
  const candidates = [...source.matchAll(/\b(\d{6})\b/g)];
  const hasAccessContext = /verification|verify|security|login|sign[ -]?in|one[- ]time|passcode|otp|kode|verifikasi|keamanan|masuk|konfirmasi|authentication/i.test(source);
  if (candidates.length === 1 && hasAccessContext) {
    const line = lines.find(item => item.includes(candidates[0][1])) || "";
    if (!accountLabel.test(line)) return candidates[0][1];
  }
  return null;
}

function safeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}@xeravion\.my\.id$/.test(address)) return null;
  return address;
}

async function adminAuthorized(request, env) {
  const supplied = bearer(request);
  if (!supplied) return false;

  // Unified admin access: validate the existing XERAVION Supabase session.
  // The publishable key is not a secret; the user's JWT is verified by Supabase
  // Auth and the is_admin RPC before any Mail administration endpoint is served.
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && supplied.split(".").length === 3) {
    try {
      const base = env.SUPABASE_URL.replace(/\/+$/, "");
      const authResponse = await fetch(base + "/auth/v1/user", {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + supplied }
      });
      if (!authResponse.ok) return false;
      const user = await authResponse.json();
      if (!user?.id) return false;
      const roleResponse = await fetch(base + "/rest/v1/rpc/is_admin", {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + supplied,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      if (!roleResponse.ok) return false;
      return (await roleResponse.json()) === true;
    } catch (error) {
      console.error("Supabase admin session verification failed", error);
      return false;
    }
  }

  // Optional legacy key path retained for break-glass maintenance only.
  if (!env.ADMIN_API_KEY) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(env.ADMIN_API_KEY)]);
  return a === b;
}

async function ensureAuditTable(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run();
}

async function logAdminAction(env, action, target, details = {}) {
  await ensureAuditTable(env);
  await env.DB.prepare("INSERT INTO admin_audit_logs (id,action,target,details) VALUES (?,?,?,?)").bind(crypto.randomUUID(), action, String(target || ""), JSON.stringify(details)).run();
}

async function listAuditLogs(request, env, url) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  await ensureAuditTable(env);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
  const rows = await env.DB.prepare("SELECT id,action,target,details,created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return json({ logs: rows.results || [] });
}


// Password credentials and short-lived buyer sessions. Passwords use PBKDF2-SHA256.
async function ensureAuthTables(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS mailbox_credentials (mailbox_id TEXT PRIMARY KEY, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS buyer_sessions (token_hash TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id))").run();
}
function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}
async function derivePassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(x => parseInt(x,16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt, iterations:100000}, key, 256);
  return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function saveMailboxPassword(env, mailboxId, password) {
  await ensureAuthTables(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map(x=>x.toString(16).padStart(2,"0")).join("");
  const hash = await derivePassword(password, saltHex);
  await env.DB.prepare("INSERT INTO mailbox_credentials (mailbox_id,password_salt,password_hash) VALUES (?,?,?) ON CONFLICT(mailbox_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(mailboxId,saltHex,hash).run();
}
async function setMailboxPassword(request, env) {
  if (!(await adminAuthorized(request, env))) return json({error:"Unauthorized"},401);
  const body = await request.json().catch(()=>null);
  const address = safeAddress(body?.address);
  if (!address) return json({error:"Alamat email tidak valid"},400);
  const mailbox = await env.DB.prepare("SELECT id,address,mailbox_type,is_active FROM mailboxes WHERE address=?").bind(address).first();
  if (!mailbox || mailbox.mailbox_type !== "game_account") return json({error:"Mailbox game aktif tidak ditemukan"},404);
  if (!mailbox.is_active) return json({error:"Aktifkan mailbox sebelum mengatur password"},400);
  const mode = body?.mode === "manual" ? "manual" : "random";
  const password = mode === "manual" ? String(body?.password || "") : randomPassword();
  if (mode === "manual" && (password.length < 8 || password.length > 128)) return json({error:"Password manual harus 8–128 karakter"},400);
  await saveMailboxPassword(env,mailbox.id,password);
  await logAdminAction(env,mode === "manual" ? "password_manual_set" : "password_random_set",address);
  return json({ok:true,address,password,mode,note:"Password hanya ditampilkan pada proses ini. Simpan dengan aman."});
}
async function buyerPasswordLogin(request, env) {
  const body = await request.json().catch(()=>null);
  const address = safeAddress(body?.address);
  const password = String(body?.password || "");
  if (!address || password.length < 1 || password.length > 256) return json({error:"Email atau kata sandi tidak valid"},400);
  await ensureAuthTables(env);
  const mailbox = await env.DB.prepare("SELECT id,address FROM mailboxes WHERE address=? AND mailbox_type='game_account' AND is_active=1").bind(address).first();
  if (!mailbox) return json({error:"Email atau kata sandi salah"},401);
  const credential = await env.DB.prepare("SELECT password_salt,password_hash FROM mailbox_credentials WHERE mailbox_id=?").bind(mailbox.id).first();
  if (!credential) return json({error:"Password belum dibuat. Hubungi admin XERAVION."},401);
  const candidate = await derivePassword(password,credential.password_salt);
  if (candidate !== credential.password_hash) return json({error:"Email atau kata sandi salah"},401);
  const sessionToken = randomToken();
  const tokenHash = await sha256(sessionToken);
  await env.DB.prepare("DELETE FROM buyer_sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  await env.DB.prepare("INSERT INTO buyer_sessions (token_hash,mailbox_id,expires_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+12 hours'))").bind(tokenHash,mailbox.id).run();
  return json({ok:true,address:mailbox.address,accessToken:sessionToken});
}

async function resolveBuyer(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  const legacy = await env.DB.prepare(
    "SELECT id, address, mailbox_type FROM mailboxes WHERE access_token_hash = ? AND is_active = 1 AND mailbox_type = 'game_account'"
  ).bind(hash).first();
  if (legacy) return legacy;
  await ensureAuthTables(env);
  return await env.DB.prepare("SELECT m.id,m.address,m.mailbox_type FROM buyer_sessions s JOIN mailboxes m ON m.id=s.mailbox_id WHERE s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND m.is_active=1 AND m.mailbox_type='game_account'").bind(hash).first();
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

  // Keep the legacy token-hash column populated for game mailboxes.
  // Buyer authentication uses password-based sessions; this random legacy hash
  // is never returned to the client and cannot be used to sign in.
  tokenHash = gameCode ? await sha256(randomToken()) : null;
  await env.DB.prepare(
    "INSERT INTO mailboxes (id,address,mailbox_type,game_code,access_token_hash) VALUES (?,?,?,?,?)"
  ).bind(id, address, gameCode ? "game_account" : "support", gameCode, tokenHash).run();
  let password = null;
  if (gameCode) { password = randomPassword(); await saveMailboxPassword(env,id,password); }
  await logAdminAction(env, "mailbox_created", address, { mailbox_type: gameCode ? "game_account" : "support", game_code: gameCode, password_created: !!password });
  return json({ ok: true, address, password, note: password ? "Password acak dibuat. Admin dapat menggantinya dengan password manual kapan saja." : "Inbox support hanya dapat diakses admin." }, 201);
}


async function rotateMailboxToken(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const address = safeAddress(body?.address);
  if (!address) return json({ error: "Alamat email tidak valid" }, 400);
  const mailbox = await env.DB.prepare(
    "SELECT id,address FROM mailboxes WHERE address = ? AND mailbox_type = 'game_account' AND is_active = 1"
  ).bind(address).first();
  if (!mailbox) return json({ error: "Mailbox tidak ditemukan" }, 404);
  const accessToken = randomToken();
  const tokenHash = await sha256(accessToken);
  await env.DB.prepare("UPDATE mailboxes SET access_token_hash = ? WHERE id = ?")
    .bind(tokenHash, mailbox.id).run();
  await logAdminAction(env, "token_rotated", mailbox.address);
  return json({
    ok: true,
    address: mailbox.address,
    accessToken,
    note: "Token lama langsung tidak berlaku. Simpan token baru; token hanya ditampilkan sekali."
  });
}

async function listMailboxes(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const result = await env.DB.prepare(
    "SELECT id,address,mailbox_type,game_code,is_active,created_at FROM mailboxes ORDER BY CASE WHEN mailbox_type = 'support' THEN 0 ELSE 1 END, game_code ASC, address COLLATE NOCASE ASC"
  ).all();
  return json({ mailboxes: result.results || [] });
}

async function adminStats(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const [mb, msg] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive FROM mailboxes").first(),
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread FROM messages").first()
  ]);
  return json({ mailboxes: { total: Number(mb?.total || 0), active: Number(mb?.active || 0), inactive: Number(mb?.inactive || 0) }, messages: { total: Number(msg?.total || 0), unread: Number(msg?.unread || 0) } });
}

async function setMailboxStatus(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const address = safeAddress(body?.address);
  if (!address || typeof body?.isActive !== "boolean") return json({ error: "Alamat atau status tidak valid" }, 400);
  const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?").bind(address).first();
  if (!mailbox) return json({ error: "Mailbox tidak ditemukan" }, 404);
  await env.DB.prepare("UPDATE mailboxes SET is_active = ? WHERE id = ?").bind(body.isActive ? 1 : 0, mailbox.id).run();
  await logAdminAction(env, body.isActive ? "mailbox_activated" : "mailbox_deactivated", address);
  return json({ ok: true, address, is_active: body.isActive ? 1 : 0 });
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
  if (!recipient) { message.setReject("Invalid XERAVION recipient"); return; }
  const mailbox = await env.DB.prepare("SELECT id,address FROM mailboxes WHERE address = ? AND is_active = 1").bind(recipient).first();
  if (!mailbox) { message.setReject("Unknown XERAVION mailbox"); return; }
  if (Number(message.rawSize || 0) > MAX_EMAIL_BYTES) { message.setReject("Message exceeds XERAVION size limit"); return; }
  const raw = await new Response(message.raw).arrayBuffer();
  if (raw.byteLength > MAX_EMAIL_BYTES) { message.setReject("Message exceeds XERAVION size limit"); return; }
  const parsed = await PostalMime.parse(raw);
  const id = crypto.randomUUID();
  const bodyText = String(parsed.text || htmlToReadableText(parsed.html) || "");
  const subject = String(parsed.subject || message.headers.get("subject") || "");
  const sender = String(parsed.from?.address || message.from || "");
  const attachmentRows = [];
  let rawKey = "d1-only/" + id;
  if (env.MAIL_STORE) {
    rawKey = "messages/" + mailbox.id + "/" + id + "/original.eml";
    await env.MAIL_STORE.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });
    for (const item of (parsed.attachments || [])) {
      const attachmentId = crypto.randomUUID();
      const filename = String(item.filename || ("attachment-" + attachmentId)).replace(/[\r\n\0]/g, "_").slice(0,240);
      const contentType = String(item.mimeType || "application/octet-stream").slice(0,160);
      const key = "attachments/" + mailbox.id + "/" + id + "/" + attachmentId;
      await env.MAIL_STORE.put(key, item.content, { httpMetadata: { contentType } });
      attachmentRows.push({id:attachmentId,name:filename,contentType,size:Number(item.content?.byteLength || 0),key,available:true});
    }
  } else {
    for (const item of (parsed.attachments || [])) attachmentRows.push({id:crypto.randomUUID(),name:String(item.filename || "Lampiran"),contentType:String(item.mimeType || "application/octet-stream"),size:Number(item.content?.byteLength || 0),available:false});
  }
  await env.DB.prepare(`INSERT INTO messages (id,mailbox_id,sender,recipient,subject,body_text,otp_code,r2_key,raw_size,attachments_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,mailbox.id,sender.slice(0,320),recipient,subject.slice(0,998),bodyText,extractOtp(subject + "\n" + bodyText),rawKey,raw.byteLength,JSON.stringify(attachmentRows)).run();
}

async function deleteAdminMessage(request, env, messageId, address) {
  if (!(await adminAuthorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const safe = safeAddress(address);
  if (!safe || !messageId) return json({ error: "Permintaan tidak valid" }, 400);
  const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?").bind(safe).first();
  if (!mailbox) return json({ error: "Mailbox tidak ditemukan" }, 404);
  const result = await env.DB.prepare("DELETE FROM messages WHERE id = ? AND mailbox_id = ?").bind(messageId, mailbox.id).run();
  if (!Number(result.meta?.changes || 0)) return json({ error: "Email tidak ditemukan" }, 404);
  await logAdminAction(env, "email_deleted", safe, { message_id: messageId });
  return json({ ok: true, deleted: true });
}

async function findAttachment(messageId, attachmentId, env) {
  const row = await env.DB.prepare("SELECT attachments_json FROM messages WHERE id=?").bind(messageId).first();
  if (!row) return null;
  let items=[]; try { items=JSON.parse(row.attachments_json || "[]"); } catch {}
  return items.find(x=>x.id===attachmentId && x.key) || null;
}
async function attachmentObjectResponse(item, env) {
  if (!item || !item.key) return new Response("Lampiran tidak tersedia", {status:404});
  if (!env.MAIL_STORE) return new Response("Penyimpanan lampiran belum dikonfigurasi", {status:503});
  const object=await env.MAIL_STORE.get(item.key);
  if (!object) return new Response("Lampiran tidak ditemukan", {status:404});
  const headers=new Headers(); object.writeHttpMetadata(headers);
  headers.set("content-disposition","attachment; filename*=UTF-8''"+encodeURIComponent(item.name || "lampiran"));
  headers.set("cache-control","private, no-store"); headers.set("x-content-type-options","nosniff");
  return new Response(object.body,{headers});
}
async function adminAttachmentResponse(request, env, url, messageId, attachmentId) {
  if (!(await adminAuthorized(request, env))) return new Response("Unauthorized",{status:401});
  return attachmentObjectResponse(await findAttachment(messageId,attachmentId,env),env);
}
async function attachmentResponse(mailboxId, messageId, attachmentId, env) {
  const owns=await env.DB.prepare("SELECT id FROM messages WHERE id=? AND mailbox_id=?").bind(messageId,mailboxId).first();
  if (!owns) return new Response("Email tidak ditemukan",{status:404});
  return attachmentObjectResponse(await findAttachment(messageId,attachmentId,env),env);
}

const BUYER_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101114"><title>XERAVION MAIL — Inbox</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#070a12;color:#edf3ff;--gold:#e8cc91;--gold2:#c49a4a;--blue:#39a8ff;--red:#ff536b;--muted:#aab7ca;--line:#26364d;--panel:#101827;--panel2:#151f30}
*{box-sizing:border-box}html{min-height:100%;background:#070a12}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 12% 8%,#0879d933 0,transparent 34%),radial-gradient(ellipse at 92% 24%,#d6294930 0,transparent 31%),radial-gradient(ellipse at 52% -18%,#263e6655 0,transparent 48%),#070a12;color:#edf3ff}

button,input{font:inherit}button{cursor:pointer}.head{position:sticky;top:0;z-index:20;padding:15px max(18px,calc((100% - 1040px)/2));border-bottom:1px solid #3479b866;background:#080d18ed;backdrop-filter:blur(18px);display:flex;align-items:center;gap:12px;box-shadow:0 10px 35px #0005}
.logo{width:47px;height:47px;flex:0 0 47px;object-fit:contain;display:block;filter:drop-shadow(0 4px 12px #238de866)}
.brand{font-weight:900;letter-spacing:3.4px;font-size:21px}.brand small{display:block;color:#91c9ff;font-weight:600;font-size:9px;letter-spacing:2.7px;margin-top:4px}.pill{font-size:9px;letter-spacing:2px;border:1px solid #3479b8;padding:7px 11px;border-radius:30px;color:#9ed4ff;margin-left:auto;background:#10243a}
main{position:relative;z-index:1;max-width:1040px;margin:38px auto;padding:0 20px}.card{background:linear-gradient(145deg,#142238ed,#0b101bf2);border:1px solid #29476b;border-radius:19px;padding:22px;margin-bottom:17px;box-shadow:0 18px 42px #0006,inset 0 1px #ffffff08}
h2{font-size:clamp(20px,3vw,27px);letter-spacing:-.6px;color:#e5f2ff}h3{color:#ffc0c8}.muted{color:#aab7ca}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
input{min-width:0;flex:1;background:#080f1b;border:1px solid #29476b;border-radius:11px;padding:13px 15px;color:#f5ead4;outline:none;transition:border-color .2s,box-shadow .2s}input:focus{border-color:#48aaff;box-shadow:0 0 0 3px #249dff24}input::placeholder{color:#827967}
button{border-radius:11px;padding:12px 16px;border:1px solid #4aa9f5;background:linear-gradient(120deg,#7bd0ff,#258ce2 60%,#1760aa);color:#06111e;font-weight:850;letter-spacing:.2px;box-shadow:0 7px 18px #168de833;transition:filter .2s,transform .2s}button:hover{filter:brightness(1.1);transform:translateY(-1px)}button.secondary{background:linear-gradient(145deg,#17263a,#0c1422);color:#b9dcff;border:1px solid #35618d;box-shadow:none}.hidden{display:none!important}
.notice{padding:12px 14px;border-radius:11px;background:#10263b;border:1px solid #287bb7;color:#c5e7ff;margin-top:12px;font-size:12px;line-height:1.6}.error{background:#351b29;border-color:#a33d59;color:#ffc0cc}
.mail{padding:10px 12px;border-bottom:1px solid #263c56;cursor:pointer;text-align:left;transition:background .18s,border-color .18s}.mail:hover{background:linear-gradient(90deg,#392b174d,transparent);border-color:#98743a}.mail strong{display:block;text-align:left;color:#e7f2ff;font-size:13px;line-height:1.35;margin-bottom:3px}.mail small{display:block;text-align:left;color:#aab7ca;font-size:10px;line-height:1.35}.mail .otp{font-size:14px;letter-spacing:2px;padding:2px 0 0;text-align:left}.otp{font-size:28px;letter-spacing:4px;color:#79c8ff;font-weight:900;padding:12px 0;text-shadow:0 0 22px #218de855}.empty{padding:24px 14px;text-align:center;color:#a99d89}#messages:not(.empty){padding:0;text-align:left}#listView{padding:10px 12px}.detail{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;color:#ddd2bd;font-size:13px}.card .card{background:#100e0b;border-color:#29415e;box-shadow:none}
hr{border:0;border-top:1px solid #263c56}
@media(max-width:600px){main{margin:20px auto;padding:0 13px}.card{padding:16px;border-radius:16px}.head{padding:12px 14px}.logo{width:39px;height:39px;flex-basis:39px}.brand{font-size:17px;letter-spacing:2px}.brand small{font-size:8px;letter-spacing:1.8px}.pill{font-size:8px;padding:6px 8px}.row button{padding:11px 12px;font-size:12px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}
</style></head><body>
<header class="head"><img class="logo" src="https://xeravion.my.id/assets/file_0000000027ec8211877e42918a96984e.png" alt="Logo XERAVION"><div class="brand">XERAVION MAIL<small>KOTAK MASUK</small></div><span class="pill">PRIVATE</span></header>
<main>
<section id="login" class="card"><h2 style="margin-top:0">Buka kotak masuk</h2><p class="muted">Masuk menggunakan alamat email dan kata sandi.</p><div class="login-fields" style="display:flex;flex-direction:column;gap:12px;align-items:stretch"><input id="emailAddress" type="email" autocomplete="username" placeholder="Alamat email XERAVION" style="width:100%;flex:none"><input id="emailPassword" type="password" autocomplete="current-password" placeholder="Kata sandi" style="width:100%;flex:none"><button id="passwordLoginBtn" style="width:100%">Masuk</button></div><div id="loginMsg"></div></section>
<section id="inbox" class="hidden">
<div class="card"><div class="row"><div><h2 id="address" style="margin:0">Kotak masuk</h2><p class="muted" style="margin:6px 0 0">Email yang diterima untuk alamat ini.</p></div><button id="refreshBtn" class="secondary" style="margin-left:auto">Refresh</button><button id="logoutBtn" class="secondary">Keluar</button></div>
</div>
<div class="card" id="listView"><div id="messages" class="empty">Memuat email…</div></div><div class="card hidden" id="detailView"><div class="row" style="margin-bottom:16px"><button id="backBtn" class="secondary">← Kembali ke kotak masuk</button></div><div id="detail"></div></div>
</section>
</main>
<script>
(function(){
let token='',currentAddress='',lastActivity=0;
const SESSION_KEY='xeravion_buyer_session_v1';
const IDLE_LIMIT=10*60*1000;
const $=id=>document.getElementById(id);
function clearSession(){try{sessionStorage.removeItem(SESSION_KEY)}catch{}token='';currentAddress='';lastActivity=0}
function saveSession(){lastActivity=Date.now();try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({token,lastActivity}))}catch{}}
function touchSession(){if(!token)return;const now=Date.now();if(now-lastActivity>1000){lastActivity=now;try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({token,lastActivity:now}))}catch{}}}
function expiredSession(){return !lastActivity||Date.now()-lastActivity>=IDLE_LIMIT}
async function restoreSession(){let saved=null;try{saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null')}catch{}if(!saved||!saved.token||!saved.lastActivity||Date.now()-saved.lastActivity>=IDLE_LIMIT){clearSession();return}token=String(saved.token);lastActivity=Number(saved.lastActivity);try{const d=await api('/api/messages');currentAddress=d.address||'';$('address').textContent=currentAddress;$('login').classList.add('hidden');$('inbox').classList.remove('hidden');await loadMessages()}catch{clearSession();$('login').classList.remove('hidden');$('inbox').classList.add('hidden')}}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function copyText(value){
  const text=String(value??'');
  if(!text) throw new Error('Tidak ada teks untuk disalin.');
  if(navigator.clipboard && window.isSecureContext){
    try{await navigator.clipboard.writeText(text);return true}catch{}
  }
  const area=document.createElement('textarea');
  area.value=text;area.setAttribute('readonly','');
  area.style.position='fixed';area.style.left='-9999px';area.style.top='0';
  document.body.appendChild(area);area.focus();area.select();area.setSelectionRange(0,area.value.length);
  let copied=false;try{copied=document.execCommand('copy')}catch{}
  area.remove();
  if(!copied) throw new Error('Browser menolak penyalinan. Izinkan akses clipboard lalu coba lagi.');
  return true;
}
function bindCopyButton(id,value){
  const btn=$(id);if(!btn)return;
  btn.onclick=async()=>{
    const original=btn.textContent;btn.disabled=true;
    try{await copyText(value);btn.textContent='Tersalin ✓';}
    catch(e){btn.textContent='Gagal menyalin';alert(e.message)}
    finally{setTimeout(()=>{if(btn.isConnected){btn.textContent=original;btn.disabled=false}},1800)}
  };
}
async function api(path){const r=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
function showError(target,text){$(target).innerHTML='<div class="notice error">'+esc(text)+'</div>'}
async function enterInbox(sessionToken,address){token=sessionToken;currentAddress=address||'';const d=await api('/api/messages');currentAddress=d.address||currentAddress;saveSession();$('address').textContent=currentAddress;$('login').classList.add('hidden');$('inbox').classList.remove('hidden');$('loginMsg').innerHTML='';$('emailPassword').value='';await loadMessages()}
async function passwordLogin(){const address=$('emailAddress').value.trim();const password=$('emailPassword').value;if(!address||!password){showError('loginMsg','Masukkan alamat email dan kata sandi.');return}try{$('passwordLoginBtn').disabled=true;const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,password}),cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Login gagal');await enterInbox(d.accessToken,d.address)}catch(e){clearSession();showError('loginMsg',e.message)}finally{$('passwordLoginBtn').disabled=false}}
async function loadMessages(){try{const d=await api('/api/messages');const arr=d.messages||[];$('messages').classList.toggle('empty',!arr.length);$('messages').innerHTML=arr.length?arr.map(m=>'<div class="mail" data-id="'+esc(m.id)+'"><strong>'+esc(m.subject||'(Tanpa subjek)')+'</strong><small>'+esc(m.sender)+' · '+esc(new Date(m.received_at).toLocaleString('id-ID'))+'</small>'+(m.otp_code?'<div class="muted" style="font-size:9px;letter-spacing:1.4px;margin-top:5px">KODE LOGIN</div><div class="otp">'+esc(m.otp_code)+'</div>':'')+'</div>').join(''):'<div class="empty">Inbox masih kosong.</div>';document.querySelectorAll('.mail').forEach(el=>el.addEventListener('click',()=>readMessage(el.dataset.id)))}catch(e){if(/Unauthorized/i.test(e.message)){logout();showError('loginMsg','Sesi berakhir. Masukkan token kembali.')}else showError('messages',e.message)}}
async function rotateToken(){if(!selectedAddress)return; if(!confirm('Ganti token untuk '+selectedAddress+'? Token lama langsung tidak berlaku.'))return;try{const d=await api('/admin/mailboxes/rotate-token',{method:'POST',body:JSON.stringify({address:selectedAddress})});$('createResult').innerHTML='<div class="notice"><strong>Token baru untuk '+esc(d.address)+':</strong><pre>'+esc(d.accessToken)+'</pre><button class="secondary" id="copyToken">Salin token</button><p class="muted">Token lama sudah tidak berlaku. Simpan token baru dan berikan hanya kepada pembeli yang berhak.</p></div>';bindCopyButton('copyToken',d.accessToken)}catch(e){$('createResult').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
async function readMessage(id){try{const m=await api('/api/messages/'+encodeURIComponent(id));$('detail').innerHTML='<div class="muted">DARI</div><strong>'+esc(m.sender)+'</strong><p class="muted">'+esc(new Date(m.received_at).toLocaleString('id-ID'))+'</p><h2>'+esc(m.subject||'(Tanpa subjek)')+'</h2>'+(m.otp_code?'<div class="muted">KODE LOGIN TERDETEKSI</div><div class="otp">'+esc(m.otp_code)+'</div><button class="secondary" id="copyOtp">Salin kode</button>':'')+'<hr style="border:0;border-top:1px solid #383a42;margin:18px 0"><div class="detail">'+esc(m.body_text||'(Email tidak memiliki teks biasa.)')+'</div><p class="muted">Lampiran: '+((m.attachments||[]).length)+' · Lampiran belum tersedia pada versi ini.</p>';$('listView').classList.add('hidden');$('detailView').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});if(m.otp_code)bindCopyButton('copyOtp',m.otp_code)}catch(e){showError('messages',e.message)}}
function backToList(){$('detailView').classList.add('hidden');$('listView').classList.remove('hidden');$('detail').innerHTML='';window.scrollTo({top:0,behavior:'smooth'})}
function logout(){clearSession();$('emailPassword').value='';$('detail').innerHTML='';$('detailView').classList.add('hidden');$('listView').classList.remove('hidden');$('messages').innerHTML='<div class="empty">Masukkan email dan kata sandi untuk membuka inbox.</div>';$('inbox').classList.add('hidden');$('login').classList.remove('hidden')}
$('passwordLoginBtn').onclick=passwordLogin;$('emailPassword').addEventListener('keydown',e=>{if(e.key==='Enter')passwordLogin()});$('backBtn').onclick=backToList;$('refreshBtn').onclick=loadMessages;$('logoutBtn').onclick=logout;
['pointerdown','keydown','scroll','touchstart'].forEach(evt=>document.addEventListener(evt,touchSession,{passive:true}));
setInterval(()=>{if(token&&expiredSession())logout()},10000);
restoreSession();
})();
</script></body></html>`;

const ADMIN_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101114"><title>XERAVION MAIL — Admin</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#080807;color:#f7f1e6;--gold:#e8cc91;--muted:#b4a78f;--line:#51432b}
*{box-sizing:border-box}html{min-height:100%;background:#080807}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% -18%,#4b371b55 0,transparent 44%),radial-gradient(ellipse at 100% 65%,#18243b22,transparent 36%),#080807;color:#f7f1e6}
header{position:sticky;top:0;z-index:20;padding:15px max(18px,calc((100% - 1160px)/2));border-bottom:1px solid #b9975540;background:#090806ef;backdrop-filter:blur(18px);display:flex;align-items:center;gap:12px;box-shadow:0 10px 35px #0005}
.logo{width:47px;height:47px;flex:0 0 47px;object-fit:contain;display:block;border-radius:0;background:transparent;box-shadow:none}
.brand{font-weight:900;letter-spacing:3.4px;font-size:21px}.brand small{display:block;color:#bca779;font-weight:600;font-size:9px;letter-spacing:2.7px;margin-top:4px}
main{position:relative;z-index:1;max-width:1160px;margin:32px auto;padding:0 18px}.card{background:linear-gradient(145deg,#1b1710ed,#0e0d0bf2);border:1px solid #59472a;border-radius:18px;padding:20px;margin-bottom:16px;box-shadow:0 18px 42px #0006,inset 0 1px #ffffff08}
h2,h3{color:#fff0c8;letter-spacing:-.4px}.muted{color:#b4a78f}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
input,select,button{font:inherit;border-radius:11px;padding:12px 14px;border:1px solid #51432b;background:#0b0a08;color:#f5ead4;outline:none}input{min-width:0;flex:1}input:focus,select:focus{border-color:#e4c47e;box-shadow:0 0 0 3px #d3ad6520}input::placeholder{color:#827967}
button{cursor:pointer;background:linear-gradient(120deg,#f2dfad,#c99d4d 60%,#9b6d28);color:#171006;border:0;font-weight:850;transition:filter .2s,transform .2s}button:hover{filter:brightness(1.1);transform:translateY(-1px)}button.secondary{background:linear-gradient(145deg,#211b11,#100e0b);color:#f2d99f;border:1px solid #765d32;box-shadow:none}button:disabled{opacity:.5;cursor:not-allowed;transform:none}.hidden{display:none!important}
.grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px}.mailbox{display:block;width:100%;text-align:left;margin:8px 0;background:linear-gradient(145deg,#211b11,#100e0b);color:#f2e5c9;border:1px solid #51432b;border-radius:11px;font-weight:600}.mailbox.active{border-color:#d3ad68;background:linear-gradient(120deg,#4a3718,#241b0e);box-shadow:0 0 0 2px #c49a4a18}.mailbox small{display:block;color:#b4a78f;margin-top:5px}.message{padding:14px;border-bottom:1px solid #51432b;cursor:pointer;transition:background .18s}.message:hover{background:linear-gradient(90deg,#392b174d,transparent)}.message strong{display:block;color:#f7e8c6}.message small{color:#b4a78f;font-size:11px}
.otp{font-size:28px;letter-spacing:4px;color:#f4d58d;font-weight:900;padding:12px 0;text-shadow:0 0 22px #c49a4a55}.notice{padding:12px 14px;border-radius:11px;background:#211a10;border:1px solid #6e552b;color:#e8d3a8;margin-top:10px;font-size:12px;line-height:1.6}.error{background:#352222;border-color:#754040;color:#ffb4ab}.pill{font-size:10px;letter-spacing:.5px;border:1px solid #8e6d36;padding:6px 10px;border-radius:30px;color:#e8cc91;background:#21190d}.empty{padding:38px;text-align:center;color:#a99d89}.topgap{margin-top:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#e8d9bb;line-height:1.6;background:#0b0a08;border:1px solid #51432b;border-radius:10px;padding:12px}.adminstats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.adminstats .stat{background:#100e0b;border:1px solid #51432b;border-radius:12px;padding:12px}.sectionlabel{font-size:10px;color:#e8cc91;letter-spacing:2px}
@media(max-width:760px){main{margin:18px auto;padding:0 13px}.grid{grid-template-columns:1fr}.card{padding:15px;border-radius:15px}header{padding:12px 14px}.logo{width:39px;height:39px;flex-basis:39px;object-fit:contain}.brand{font-size:17px;letter-spacing:2px}.brand small{font-size:8px;letter-spacing:1.8px}.row button{font-size:11px;padding:10px}.pill{font-size:9px}.adminstats{grid-template-columns:1fr 1fr}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}

/* XERAVION blue-red theme: explicit overrides for all admin surfaces */
:root{color-scheme:dark;background:#070a12;color:#edf3ff;--muted:#aab7ca;--line:#263c56}
html{background:#070a12!important}
body{background:radial-gradient(ellipse at 12% 8%,#0879d933,transparent 34%),radial-gradient(ellipse at 92% 24%,#d6294930,transparent 31%),radial-gradient(ellipse at 52% -18%,#263e6655,transparent 48%),#070a12!important;color:#edf3ff!important}
header{background:#080d18ed!important;border-bottom:1px solid #3479b866!important}
.brand small{color:#91c9ff!important}
main .card,.card{background:linear-gradient(145deg,#142238ed,#0b101bf2)!important;border-color:#29476b!important}
h2,h3{color:#e5f2ff!important}
.muted{color:#aab7ca!important}
input,select{background:#080f1b!important;border-color:#29476b!important;color:#edf3ff!important}
input:focus,select:focus{border-color:#48aaff!important;box-shadow:0 0 0 3px #249dff24!important}
input::placeholder{color:#8196b2!important}
button:not(.secondary){background:linear-gradient(120deg,#7bd0ff,#258ce2 60%,#1760aa)!important;color:#06111e!important;border:1px solid #4aa9f5!important}
button.secondary{background:linear-gradient(145deg,#17263a,#0c1422)!important;color:#b9dcff!important;border:1px solid #35618d!important}
.mailbox{background:linear-gradient(145deg,#17263a,#0c1422)!important;color:#e1efff!important;border-color:#29476b!important}
.mailbox.active{border-color:#48aaff!important;background:linear-gradient(120deg,#164c75,#10243a)!important;box-shadow:0 0 0 2px #249dff24!important}
.mailbox small,.message small{color:#aab7ca!important}
.message{border-bottom-color:#263c56!important}
.message strong{color:#e7f2ff!important}
.otp{color:#79c8ff!important;text-shadow:0 0 22px #218de855!important}
.notice{background:#10263b!important;border-color:#287bb7!important;color:#c5e7ff!important}
.error{background:#351b29!important;border-color:#a33d59!important;color:#ffc0cc!important}
.pill{border-color:#3479b8!important;color:#9ed4ff!important;background:#10243a!important}
.empty{color:#9eb0c7!important}
pre{color:#d8eaff!important;background:#080f1b!important;border-color:#29476b!important}
.adminstats .stat{background:#101b2b!important;border-color:#29476b!important}
.sectionlabel{color:#8dcaff!important}
.logo{width:47px!important;height:47px!important;flex:0 0 47px!important;object-fit:contain!important;display:block!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;filter:drop-shadow(0 4px 12px #238de866)!important}
</style></head><body>
<header><img class="logo" src="https://xeravion.my.id/assets/file_0000000027ec8211877e42918a96984e.png" alt="Logo XERAVION"><div class="brand">XERAVION MAIL<small>ADMIN CONTROL PANEL</small></div><span class="pill" style="margin-left:auto">PRIVATE</span></header>
<main>
<section id="login" class="card"><h2>Menunggu sesi Admin XERAVION</h2><p class="muted">Panel ini menggunakan sesi admin dari Dashboard utama. Kembali ke Dashboard Admin XERAVION dan buka tab Mail untuk menghubungkan sesi secara aman.</p><div id="loginMsg"><div class="notice">Memeriksa sesi admin…</div></div></section>
<section id="app" class="hidden">
<div class="card"><div class="row"><div><h2 style="margin:0">Kelola Kotak Email</h2><p class="muted" style="margin:6px 0 0">Buat alamat dan pantau inbox XERAVION.</p></div><button class="secondary" id="refreshBtn" style="margin-left:auto">Muat ulang</button><button class="secondary" id="logoutBtn">Keluar</button></div>
<div class="row topgap"><select id="kind"><option value="ml">Mobile Legends</option><option value="ff">Free Fire</option><option value="pubg">PUBG Mobile</option><option value="support">Support (admin saja)</option></select><button id="createBtn">+ Buat alamat</button></div><div id="createResult"></div></div>
<div class="card"><h3 style="margin-top:0">Ringkasan</h3><div class="row" id="stats"><span class="pill">Memuat statistik…</span></div></div><div class="grid"><section class="card"><h3 style="margin-top:0">Daftar Inbox</h3><input id="mailboxSearch" type="search" placeholder="Cari alamat atau game" class="topgap"><div id="mailboxes" class="muted">Belum dimuat.</div></section>
<section class="card"><div class="row"><div><h3 id="selectedTitle" style="margin:0">Pilih inbox</h3><p id="selectedSub" class="muted" style="margin:6px 0 0">Daftar email akan tampil di sini.</p></div><button id="refreshMessages" class="secondary" style="margin-left:auto">Refresh</button><button id="setPasswordBtn" class="secondary">Buat password acak</button><button id="statusBtn" class="secondary" disabled>Nonaktifkan mailbox</button></div><div id="passwordResult" class="topgap"></div><div class="row topgap"><input id="search" placeholder="Cari pengirim atau subjek"><button id="searchBtn" class="secondary">Cari</button></div><div id="messages" class="empty">Pilih salah satu alamat email.</div><div id="detail" class="topgap"></div></section></div>
<details class="card" id="auditPanel" style="margin-top:16px">
  <summary style="cursor:pointer;color:#d9e8fb;font-weight:800;padding:4px 0">Riwayat Aktivitas Admin <span class="muted" style="font-size:11px;font-weight:500"> · Buka jika diperlukan</span></summary>
  <div class="row topgap"><span class="muted" style="font-size:11px">Maksimal 8 aktivitas terbaru</span><button id="auditRefresh" class="secondary" style="margin-left:auto">Refresh</button></div>
  <div id="auditLogs" class="muted topgap" style="max-height:260px;overflow:auto">Memuat riwayat…</div>
</details>
</section></main>
<script>
(function(){
let adminKey='',selectedAddress='',mailboxCache=[];
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function copyText(value){
  const text=String(value??'');
  if(!text) throw new Error('Tidak ada teks untuk disalin.');
  if(navigator.clipboard && window.isSecureContext){
    try{await navigator.clipboard.writeText(text);return true}catch(error){}
  }
  const area=document.createElement('textarea');
  area.value=text;area.setAttribute('readonly','');
  area.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;padding:0;opacity:0;z-index:-1';
  document.body.appendChild(area);
  area.focus();area.select();area.setSelectionRange(0,area.value.length);
  let copied=false;
  try{copied=document.execCommand('copy')}catch(error){}
  area.blur();area.remove();
  if(!copied) throw new Error('Penyalinan diblokir browser. Tekan lama teks password lalu pilih Salin.');
  return true;
}
function bindCopyButton(id,value){
  const btn=$(id);if(!btn)return;
  btn.onclick=async()=>{
    const original=btn.textContent;
    try{await copyText(value);btn.textContent='Berhasil disalin ✓';btn.disabled=true;
      setTimeout(()=>{if(btn.isConnected){btn.textContent=original;btn.disabled=false}},1800);
    }catch(error){alert(error.message)}
  };
}
async function api(path,opts){opts=opts||{};opts.headers=Object.assign({},opts.headers||{},{Authorization:'Bearer '+adminKey});if(opts.body)opts.headers['Content-Type']='application/json';const r=await fetch(path,opts);let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
function message(text,error){$('loginMsg').innerHTML='<div class="notice '+(error?'error':'')+'">'+esc(text)+'</div>'}
async function login(){if(!adminKey){message('Sesi admin XERAVION belum diterima. Buka panel ini dari Dashboard Admin utama.',true);return}try{await api('/admin/mailboxes');$('login').classList.add('hidden');$('app').classList.remove('hidden');$('loginMsg').innerHTML='';await loadMailboxes();await loadStats();await loadAuditLogs();const savedAddress=sessionStorage.getItem('xerMailSelectedAddress')||'';if(savedAddress&&mailboxCache.some(m=>m.address===savedAddress)){await selectMailbox(savedAddress);const savedMessage=sessionStorage.getItem('xerMailSelectedMessage')||'';if(savedMessage)await readMessage(savedMessage)}else{sessionStorage.removeItem('xerMailSelectedAddress');sessionStorage.removeItem('xerMailSelectedMessage')}}catch(e){adminKey='';message('Sesi admin ditolak atau server bermasalah: '+e.message,true)}}
async function loadStats(){const d=await api('/admin/stats');$('stats').innerHTML='<span class="pill">Total mailbox: '+d.mailboxes.total+'</span><span class="pill">Aktif: '+d.mailboxes.active+'</span><span class="pill">Nonaktif: '+d.mailboxes.inactive+'</span><span class="pill">Total email: '+d.messages.total+'</span><span class="pill">Belum dibaca: '+d.messages.unread+'</span>'}
async function loadAuditLogs(){const d=await api('/admin/audit-logs?limit=8');const names={mailbox_created:'Mailbox dibuat',email_deleted:'Email dihapus',mailbox_activated:'Mailbox diaktifkan',mailbox_deactivated:'Mailbox dinonaktifkan',password_manual_set:'Password manual diatur',password_random_set:'Password acak dibuat'};const logs=d.logs||[];$('auditLogs').innerHTML=logs.length?logs.map(x=>'<div class="message"><strong>'+esc(names[x.action]||x.action)+'</strong><small>'+esc(x.target)+' · '+esc(new Date(x.created_at).toLocaleString('id-ID'))+'</small></div>').join(''):'<div class="empty">Belum ada aktivitas tercatat.</div>'}
async function loadMailboxes(){const d=await api('/admin/mailboxes');mailboxCache=d.mailboxes||[];renderMailboxes()}
function renderMailboxes(){
  const q=$('mailboxSearch').value.trim().toLowerCase();
  const list=mailboxCache
    .filter(m=>(m.address+' '+(m.game_code||'')+' '+m.mailbox_type).toLowerCase().includes(q))
    .sort((a,b)=>{
      const aSupport=a.mailbox_type==='support'?0:1;
      const bSupport=b.mailbox_type==='support'?0:1;
      if(aSupport!==bSupport)return aSupport-bSupport;
      const gameCompare=String(a.game_code||'').localeCompare(String(b.game_code||''));
      if(gameCompare!==0)return gameCompare;
      const numberOf=m=>Number((String(m.address||'').match(/(\\d+)@/)||[])[1]||0);
      return numberOf(a)-numberOf(b);
    });
  $('mailboxes').innerHTML=list.length?list.map(m=>'<button class="mailbox '+(m.address===selectedAddress?'active':'')+'" data-address="'+esc(m.address)+'"><strong>'+esc(m.address)+'</strong><small>'+esc(m.mailbox_type==='support'?'Support — admin only':(m.game_code||'game').toUpperCase())+' · '+(m.is_active?'Aktif':'Nonaktif')+'</small></button>').join(''):'<div class="empty">Tidak ada mailbox yang cocok.</div>';
  document.querySelectorAll('.mailbox').forEach(b=>b.addEventListener('click',()=>selectMailbox(b.dataset.address)));
}
async function changeMailboxStatus(){const m=mailboxCache.find(x=>x.address===selectedAddress);if(!m)return;const next=!Boolean(m.is_active);if(!confirm((next?'Aktifkan':'Nonaktifkan')+' mailbox '+selectedAddress+'?'))return;try{$('statusBtn').disabled=true;await api('/admin/mailboxes/status',{method:'POST',body:JSON.stringify({address:selectedAddress,isActive:next})});await loadMailboxes();await loadStats();await selectMailbox(selectedAddress)}catch(e){alert(e.message)}finally{$('statusBtn').disabled=false}}
async function createMailbox(){try{$('createBtn').disabled=true;const v=$('kind').value;const body=v==='support'?{type:'support'}:{game:v};const d=await api('/admin/mailboxes',{method:'POST',body:JSON.stringify(body)});$('createResult').innerHTML='<div class="notice"><strong>Alamat dibuat: '+esc(d.address)+'</strong>'+(d.password?'<p>Password acak awal:</p><pre>'+esc(d.password)+'</pre><button class="secondary" id="copyPassword">Salin password</button><p class="muted">Simpan password ini. Anda juga bisa menggantinya dengan password manual atau membuat password acak baru dari pengaturan mailbox.</p>':'<p>'+esc(d.note||'')+'</p>')+'</div>';if(d.password)bindCopyButton('copyPassword',d.password);await loadMailboxes();if(d.address)await selectMailbox(d.address)}catch(e){$('createResult').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}finally{$('createBtn').disabled=false}}

async function selectMailbox(address){if(selectedAddress!==address)sessionStorage.removeItem('xerMailSelectedMessage');selectedAddress=address;sessionStorage.setItem('xerMailSelectedAddress',address);const m=mailboxCache.find(x=>x.address===address);$('selectedTitle').textContent=address;$('selectedSub').textContent=m&&!m.is_active?'Mailbox nonaktif — email baru ditolak.':'Email masuk untuk alamat ini';$('statusBtn').textContent=m&&m.is_active?'Nonaktifkan mailbox':'Aktifkan mailbox';$('statusBtn').disabled=false;$('passwordResult').innerHTML='<h4 style="margin:0 0 8px">Pengaturan kata sandi</h4><p class="muted">Pilih salah satu cara untuk membuat atau mengganti password mailbox ini. Minimal 8 karakter.</p><div class="row"><input id="manualPassword" type="password" autocomplete="new-password" placeholder="Password manual (min. 8 karakter)"><input id="confirmManualPassword" type="password" autocomplete="new-password" placeholder="Konfirmasi password"></div><div class="row topgap"><button id="manualPasswordBtn" class="secondary">Simpan password manual</button><button id="setPasswordBtn">Buat password acak</button></div><div id="passwordResultMessage"></div>';$('manualPasswordBtn').onclick=()=>setPassword('manual');$('setPasswordBtn').onclick=()=>setPassword('random');renderMailboxes();await loadMessages()}
async function loadMessages(){if(!selectedAddress)return;try{const q=encodeURIComponent($('search').value.trim());const d=await api('/admin/messages?address='+encodeURIComponent(selectedAddress)+'&q='+q);const arr=d.messages||[];$('messages').innerHTML=arr.length?arr.map(m=>'<div class="message" data-id="'+esc(m.id)+'"><strong>'+esc(m.subject||'(Tanpa subjek)')+'</strong><small>'+esc(m.sender)+' · '+esc(new Date(m.received_at).toLocaleString('id-ID'))+'</small>'+(m.otp_code?'<div class="otp" style="font-size:18px">'+esc(m.otp_code)+'</div>':'')+'</div>').join(''):'<div class="empty">Inbox masih kosong.</div>';document.querySelectorAll('.message').forEach(el=>el.addEventListener('click',()=>readMessage(el.dataset.id)))}catch(e){$('messages').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
async function deleteMessage(id,subject){if(!confirm('Hapus email "'+(subject||'(Tanpa subjek)')+'" secara permanen?'))return;try{await api('/admin/messages/'+encodeURIComponent(id)+'?address='+encodeURIComponent(selectedAddress),{method:'DELETE'});$('detail').innerHTML='<div class="notice">Email berhasil dihapus.</div>';await loadMessages()}catch(e){$('detail').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
async function setPassword(mode){if(!selectedAddress){$('passwordResultMessage').innerHTML='<div class="notice error">Pilih inbox game terlebih dahulu.</div>';return}let password='';if(mode==='manual'){password=$('manualPassword').value;if(password.length<8||password.length>128){$('passwordResultMessage').innerHTML='<div class="notice error">Password manual harus 8–128 karakter.</div>';return}if(password!==$('confirmManualPassword').value){$('passwordResultMessage').innerHTML='<div class="notice error">Konfirmasi password tidak sama.</div>';return}}if(!confirm((mode==='manual'?'Atur password manual':'Buat password acak')+' untuk '+selectedAddress+'? Password lama akan langsung tidak berlaku.'))return;try{$('setPasswordBtn').disabled=true;$('manualPasswordBtn').disabled=true;$('passwordResultMessage').innerHTML='<div class="notice">Sedang menyimpan password…</div>';const d=await api('/admin/mailboxes/set-password',{method:'POST',body:JSON.stringify({address:selectedAddress,mode,password})});$('passwordResultMessage').innerHTML='<div class="notice"><strong>Password '+(mode==='manual'?'manual':'acak')+' berhasil disimpan untuk '+esc(d.address)+':</strong><pre>'+esc(d.password)+'</pre><button class="secondary" id="copyNewPassword">Salin password</button><p class="muted">Password lama sudah tidak berlaku. Simpan password baru ini. Password hanya ditampilkan pada proses ini.</p></div>';bindCopyButton('copyNewPassword',d.password);$('manualPassword').value='';$('confirmManualPassword').value=''}catch(e){$('passwordResultMessage').innerHTML='<div class="notice error">Gagal menyimpan password: '+esc(e.message)+'</div>'}finally{$('setPasswordBtn').disabled=false;$('manualPasswordBtn').disabled=false}}
async function readMessage(id){try{sessionStorage.setItem('xerMailSelectedMessage',id);const m=await api('/admin/messages/'+encodeURIComponent(id)+'?address='+encodeURIComponent(selectedAddress));$('detail').innerHTML='<div class="card"><div class="muted">DARI</div><strong>'+esc(m.sender)+'</strong><p class="muted">'+esc(m.received_at)+'</p><h3>'+esc(m.subject||'(Tanpa subjek)')+'</h3>'+(m.otp_code?'<div class="muted">KODE TERDETEKSI</div><div class="otp">'+esc(m.otp_code)+'</div>':'')+'<pre>'+esc(m.body_text||'(Email tidak memiliki teks biasa.)')+'</pre><div class="muted">Lampiran: '+((m.attachments||[]).length)+' · Penyimpanan lampiran belum diaktifkan.</div><button class="secondary" id="deleteMessageBtn" style="background:#542727;border-color:#754040;color:#ffd8d3;margin-top:14px">Hapus email ini</button></div>';$('deleteMessageBtn').onclick=()=>deleteMessage(m.id,m.subject)}catch(e){$('detail').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
window.addEventListener('message',event=>{if(event.origin!=='https://xeravion.my.id'||event.data?.type!=='XERAVION_ADMIN_SESSION'||typeof event.data.accessToken!=='string')return;adminKey=event.data.accessToken;login()});$('createBtn').onclick=createMailbox;$('refreshBtn').onclick=async()=>{await loadMailboxes();await loadStats();await loadMessages();await loadAuditLogs()};$('refreshMessages').onclick=async()=>{await loadMessages();await loadStats()};$('statusBtn').onclick=changeMailboxStatus;$('mailboxSearch').addEventListener('input',renderMailboxes);$('auditRefresh').onclick=loadAuditLogs;$('searchBtn').onclick=()=>loadMessages();$('logoutBtn').onclick=()=>{adminKey='';selectedAddress='';sessionStorage.removeItem('xerMailSelectedAddress');sessionStorage.removeItem('xerMailSelectedMessage');$('app').classList.add('hidden');$('login').classList.remove('hidden');$('createResult').innerHTML='';$('detail').innerHTML=''};
})();
</script></body></html>`;

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
    // Normalize trailing slashes so /inbox and /inbox/ resolve identically.
    const path = url.pathname.replace(/\/+$/, "") || "/";
    let response;

    if (path === "/" && request.method === "GET") {
      response = Response.redirect(new URL("/inbox", url.origin), 302);
    } else if (path === "/inbox" && request.method === "GET") {
      response = new Response(BUYER_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    } else if (path === "/panel" && request.method === "GET") {
      response = new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    } else if (path === "/health" && request.method === "GET") {
      response = json({ ok: true, service: "xeravion-mail", status: "worker-online", version: "password-token-auth-v1" });
    } else if (path === "/api/login" && request.method === "POST") {
      response = await buyerPasswordLogin(request, env);
    } else if (path === "/admin/mailboxes/set-password" && request.method === "POST") {
      response = await setMailboxPassword(request, env);
    } else if (path === "/admin/audit-logs" && request.method === "GET") {
      response = await listAuditLogs(request, env, url);
    } else if (path === "/admin/stats" && request.method === "GET") {
      response = await adminStats(request, env);
    } else if (path === "/admin/mailboxes/status" && request.method === "POST") {
      response = await setMailboxStatus(request, env);
    } else if (path === "/admin/mailboxes/rotate-token" && request.method === "POST") {
      response = await rotateMailboxToken(request, env);
    } else if (path === "/admin/mailboxes" && request.method === "POST") {
      response = await createMailbox(request, env);
    } else if (path === "/admin/mailboxes" && request.method === "GET") {
      response = await listMailboxes(request, env);
    } else if (path === "/admin/messages" && request.method === "GET") {
      if (!(await adminAuthorized(request, env))) response = json({ error: "Unauthorized" }, 401);
      else {
        const address = safeAddress(url.searchParams.get("address"));
        const mailbox = address ? await env.DB.prepare("SELECT id,address FROM mailboxes WHERE address = ?").bind(address).first() : null;
        response = mailbox ? await listMessages(mailbox, env, url) : json({ error: "Mailbox not found" }, 404);
      }
    } else if (path.startsWith("/admin/messages/") && request.method === "GET") {
      if (!(await adminAuthorized(request, env))) response = json({ error: "Unauthorized" }, 401);
      else {
        const address = safeAddress(url.searchParams.get("address"));
        const mailbox = address ? await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?").bind(address).first() : null;
        response = mailbox ? await readMessage(mailbox.id, path.split("/").pop(), env) : json({ error: "Mailbox not found" }, 404);
      }
    } else if (path.startsWith("/admin/messages/") && request.method === "DELETE") {
      response = await deleteAdminMessage(request, env, path.split("/").pop(), url.searchParams.get("address"));
    } else if (path === "/api/messages" && request.method === "GET") {
      const mailbox = await resolveBuyer(request, env);
      response = mailbox ? await listMessages(mailbox, env, url) : json({ error: "Unauthorized" }, 401);
    } else if (path.startsWith("/api/messages/") && request.method === "GET") {
      const mailbox = await resolveBuyer(request, env);
      response = mailbox ? await readMessage(mailbox.id, path.split("/").pop(), env) : json({ error: "Unauthorized" }, 401);
    } else if (path.startsWith("/admin/attachments/") && request.method === "GET") {
      const parts = path.split("/");
      response = await adminAttachmentResponse(request, env, url, parts[3], parts[4]);
    } else if (path.startsWith("/api/attachments/") && request.method === "GET") {
      const mailbox = await resolveBuyer(request, env);
      const parts = path.split("/");
      response = mailbox ? await attachmentResponse(mailbox.id, parts[3], parts[4], env) : new Response("Unauthorized", { status: 401 });
    } else {
      response = json({ error: "Not found" }, 404);
    }

    const merged = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) merged.set(key, value);
    return new Response(response.body, { status: response.status, headers: merged });
  }
};
