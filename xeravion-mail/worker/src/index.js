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
  const source = String(text || "").replace(/\u00a0/g, " ");
  const cues = /verification|verify|security|login|sign[ -]?in|one[- ]time|passcode|otp|kode|verifikasi|keamanan|masuk|konfirmasi|confirmation|authentication|authentikasi/i;
  const candidates = [...source.matchAll(/\b(\d{4,8})\b/g)];
  if (!candidates.length) return null;

  // Prefer a number explicitly described as a verification/security/login code.
  for (const match of candidates) {
    const start = Math.max(0, match.index - 75);
    const end = Math.min(source.length, match.index + match[0].length + 75);
    const context = source.slice(start, end);
    if (cues.test(context)) return match[1];
  }

  // Conservative fallback: accept a single six-digit candidate only when the
  // message itself discusses account access or verification.
  const sixDigit = candidates.filter(match => match[1].length === 6);
  if (sixDigit.length === 1 && cues.test(source)) return sixDigit[0][1];
  return null;
}

function safeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}@xeravion\.my\.id$/.test(address)) return null;
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
  const bodyText = String(parsed.text || "").slice(0, 200000);
  const subject = String(parsed.subject || message.headers.get("subject") || "").slice(0, 998);
  const sender = String(parsed.from?.address || message.from || "").slice(0, 320);

  // MVP mode: store searchable message text in D1 only.
  // Raw MIME and attachments are intentionally not retained until R2 is enabled.
  await env.DB.prepare(
    `INSERT INTO messages (id,mailbox_id,sender,recipient,subject,body_text,otp_code,r2_key,raw_size,attachments_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, mailbox.id, sender, recipient, subject, bodyText,
    extractOtp(subject + "\\n" + bodyText),
    "d1-only/" + id, raw.byteLength, "[]"
  ).run();
}

async function attachmentResponse(mailboxId, messageId, attachmentId, env) {
  return new Response("Attachments are not enabled in the current D1-only edition", { status: 501 });
}

const BUYER_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101114"><title>XERAVION MAIL — Inbox</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#101114;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;min-height:100vh}.head{padding:18px max(18px,calc((100% - 900px)/2));border-bottom:1px solid #303238;display:flex;align-items:center;gap:12px}.logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(145deg,#f5d88a,#9d7025);color:#171717;display:grid;place-items:center;font-weight:900;font-size:22px}.brand{font-weight:800;letter-spacing:1px}.brand small{display:block;color:#a1a1aa;font-weight:500;letter-spacing:.2px;margin-top:3px}main{max-width:900px;margin:28px auto;padding:0 16px}.card{background:#191a1f;border:1px solid #33353d;border-radius:16px;padding:20px;margin-bottom:16px}.muted{color:#a1a1aa}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}input,button{font:inherit;border-radius:10px;padding:13px 14px;border:1px solid #41434c;background:#111216;color:#f4f4f5}input{min-width:0;flex:1}button{cursor:pointer;background:#c9a45d;color:#171717;border:0;font-weight:700}button.secondary{background:#292b32;color:#f4f4f5;border:1px solid #454751}.hidden{display:none!important}.notice{padding:11px 13px;border-radius:10px;background:#252b25;color:#b7e1bd;margin-top:12px}.error{background:#352222;color:#ffb4ab}.mail{padding:15px;border-bottom:1px solid #34363d;cursor:pointer}.mail:hover{background:#24262d}.mail strong{display:block}.mail small{color:#aaa}.otp{font-size:28px;letter-spacing:4px;color:#f4d58d;font-weight:800;padding:12px 0}.empty{padding:35px;text-align:center;color:#999}.detail{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;color:#ddd}.pill{font-size:12px;border:1px solid #555;padding:5px 9px;border-radius:20px;color:#d9c18d;margin-left:auto}@media(max-width:600px){main{margin:16px auto}.card{padding:15px}.head{padding:14px 16px}}
</style></head><body>
<header class="head"><div class="logo">X</div><div class="brand">XERAVION MAIL<small>KOTAK MASUK</small></div><span class="pill">PRIVATE</span></header>
<main>
<section id="login" class="card"><h2 style="margin-top:0">Buka kotak masuk</h2><p class="muted">Masukkan token akses yang diberikan admin XERAVION. Token hanya digunakan selama halaman ini terbuka.</p><div class="row"><input id="token" type="password" autocomplete="off" placeholder="Token akses pembeli"><button id="openBtn">Buka inbox</button></div><div id="loginMsg"></div></section>
<section id="inbox" class="hidden">
<div class="card"><div class="row"><div><h2 id="address" style="margin:0">Kotak masuk</h2><p class="muted" style="margin:6px 0 0">Email yang diterima untuk alamat ini.</p></div><button id="refreshBtn" class="secondary" style="margin-left:auto">Refresh</button><button id="logoutBtn" class="secondary">Keluar</button></div>
<div class="row" style="margin-top:16px"><input id="search" type="search" placeholder="Cari pengirim atau subjek"><button id="searchBtn" class="secondary">Cari</button></div></div>
<div class="card"><div id="messages" class="empty">Memuat email…</div><div id="detail"></div></div>
</section>
</main>
<script>
(function(){
let token='',currentAddress='';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path){const r=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
function showError(target,text){$(target).innerHTML='<div class="notice error">'+esc(text)+'</div>'}
async function openInbox(){token=$('token').value.trim();if(!token){showError('loginMsg','Token belum diisi.');return}try{const d=await api('/api/messages');currentAddress=d.address||'';$('address').textContent=currentAddress;$('login').classList.add('hidden');$('inbox').classList.remove('hidden');$('loginMsg').innerHTML='';await loadMessages()}catch(e){token='';showError('loginMsg','Token tidak valid atau inbox tidak dapat dibuka: '+e.message)}}
async function loadMessages(){try{const q=encodeURIComponent($('search').value.trim());const d=await api('/api/messages?q='+q);const arr=d.messages||[];$('messages').innerHTML=arr.length?arr.map(m=>'<div class="mail" data-id="'+esc(m.id)+'"><strong>'+esc(m.subject||'(Tanpa subjek)')+'</strong><small>'+esc(m.sender)+' · '+esc(new Date(m.received_at).toLocaleString('id-ID'))+'</small>'+(m.otp_code?'<div class="otp" style="font-size:20px">'+esc(m.otp_code)+'</div>':'')+'</div>').join(''):'<div class="empty">Inbox masih kosong.</div>';document.querySelectorAll('.mail').forEach(el=>el.addEventListener('click',()=>readMessage(el.dataset.id)))}catch(e){showError('messages',e.message)}}
async function rotateToken(){if(!selectedAddress)return; if(!confirm('Ganti token untuk '+selectedAddress+'? Token lama langsung tidak berlaku.'))return;try{const d=await api('/admin/mailboxes/rotate-token',{method:'POST',body:JSON.stringify({address:selectedAddress})});$('createResult').innerHTML='<div class="notice"><strong>Token baru untuk '+esc(d.address)+':</strong><pre>'+esc(d.accessToken)+'</pre><button class="secondary" id="copyToken">Salin token</button><p class="muted">Token lama sudah tidak berlaku. Simpan token baru dan berikan hanya kepada pembeli yang berhak.</p></div>';$('copyToken').onclick=()=>navigator.clipboard.writeText(d.accessToken)}catch(e){$('createResult').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
async function readMessage(id){try{const m=await api('/api/messages/'+encodeURIComponent(id));$('detail').innerHTML='<div class="card"><div class="muted">DARI</div><strong>'+esc(m.sender)+'</strong><p class="muted">'+esc(new Date(m.received_at).toLocaleString('id-ID'))+'</p><h3>'+esc(m.subject||'(Tanpa subjek)')+'</h3>'+(m.otp_code?'<div class="muted">KODE TERDETEKSI</div><div class="otp">'+esc(m.otp_code)+'</div><button class="secondary" id="copyOtp">Salin kode</button>':'')+'<hr style="border:0;border-top:1px solid #383a42;margin:18px 0"><div class="detail">'+esc(m.body_text||'(Email tidak memiliki teks biasa.)')+'</div><p class="muted">Lampiran: '+((m.attachments||[]).length)+' · Lampiran belum tersedia pada versi ini.</p></div>';if(m.otp_code)$('copyOtp').onclick=()=>navigator.clipboard.writeText(m.otp_code)}catch(e){showError('detail',e.message)}}
function logout(){token='';currentAddress='';$('token').value='';$('search').value='';$('detail').innerHTML='';$('messages').innerHTML='<div class="empty">Masukkan token untuk membuka inbox.</div>';$('inbox').classList.add('hidden');$('login').classList.remove('hidden')}
$('openBtn').onclick=openInbox;$('token').addEventListener('keydown',e=>{if(e.key==='Enter')openInbox()});$('refreshBtn').onclick=loadMessages;$('searchBtn').onclick=loadMessages;$('logoutBtn').onclick=logout;
})();
</script></body></html>`;

const ADMIN_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101114"><title>XERAVION MAIL — Admin</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#101114;color:#f4f4f5}*{box-sizing:border-box}body{margin:0}header{padding:20px max(18px,calc((100% - 1100px)/2));border-bottom:1px solid #303238;display:flex;align-items:center;gap:12px}.logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(145deg,#f5d88a,#9d7025);color:#171717;display:grid;place-items:center;font-weight:900;font-size:22px}.brand{font-weight:800;letter-spacing:1px}.brand small{display:block;color:#a1a1aa;font-weight:500;letter-spacing:.2px;margin-top:3px}main{max-width:1100px;margin:28px auto;padding:0 18px}.card{background:#191a1f;border:1px solid #33353d;border-radius:16px;padding:20px;margin-bottom:16px}.muted{color:#a1a1aa}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}input,select,button{font:inherit;border-radius:10px;padding:12px 14px;border:1px solid #41434c;background:#111216;color:#f4f4f5}input{min-width:0;flex:1}button{cursor:pointer;background:#c9a45d;color:#171717;border:0;font-weight:700}button.secondary{background:#292b32;color:#f4f4f5;border:1px solid #454751}button:disabled{opacity:.5;cursor:not-allowed}.hidden{display:none!important}.grid{display:grid;grid-template-columns:290px 1fr;gap:16px}.mailbox{display:block;width:100%;text-align:left;margin:7px 0;background:#22242a;color:#eee;border:1px solid #383a42;font-weight:500}.mailbox.active{border-color:#d3ad68;background:#30291d}.message{padding:13px;border-bottom:1px solid #34363d;cursor:pointer}.message:hover{background:#24262d}.message strong{display:block}.message small{color:#aaa}.otp{font-size:28px;letter-spacing:4px;color:#f4d58d;font-weight:800;padding:12px 0}.notice{padding:10px 12px;border-radius:10px;background:#252b25;color:#b7e1bd;margin-top:10px}.error{background:#352222;color:#ffb4ab}.pill{font-size:12px;border:1px solid #555;padding:4px 8px;border-radius:20px;color:#d9c18d}.empty{padding:35px;text-align:center;color:#999}.topgap{margin-top:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#ddd;line-height:1.55}label{display:block;font-size:13px;color:#b7b7c0;margin-bottom:7px}@media(max-width:700px){main{margin:16px auto}.grid{grid-template-columns:1fr}.card{padding:15px}header{padding:14px 18px}}
</style></head><body>
<header><div class="logo">X</div><div class="brand">XERAVION MAIL<small>ADMIN CONTROL PANEL</small></div><span class="pill" style="margin-left:auto">PRIVATE</span></header>
<main>
<section id="login" class="card"><h2>Masuk Admin</h2><p class="muted">Masukkan ADMIN_API_KEY yang kamu simpan di Cloudflare. Kunci hanya dipakai selama halaman ini terbuka dan tidak disimpan.</p><div class="row"><input id="key" type="password" autocomplete="off" placeholder="Tempel kunci admin di sini"><button id="loginBtn">Masuk</button></div><div id="loginMsg"></div></section>
<section id="app" class="hidden">
<div class="card"><div class="row"><div><h2 style="margin:0">Kelola Kotak Email</h2><p class="muted" style="margin:6px 0 0">Buat alamat dan pantau inbox XERAVION.</p></div><button class="secondary" id="refreshBtn" style="margin-left:auto">Muat ulang</button><button class="secondary" id="logoutBtn">Keluar</button></div>
<div class="row topgap"><select id="kind"><option value="ml">Mobile Legends</option><option value="ff">Free Fire</option><option value="pubg">PUBG Mobile</option><option value="support">Support (admin saja)</option></select><button id="createBtn">+ Buat alamat</button></div><div id="createResult"></div></div>
<div class="grid"><section class="card"><h3 style="margin-top:0">Daftar Inbox</h3><div id="mailboxes" class="muted">Belum dimuat.</div></section>
<section class="card"><div class="row"><div><h3 id="selectedTitle" style="margin:0">Pilih inbox</h3><p id="selectedSub" class="muted" style="margin:6px 0 0">Daftar email akan tampil di sini.</p></div><button id="refreshMessages" class="secondary" style="margin-left:auto">Refresh</button><button id="rotateTokenBtn" class="secondary">Ganti token</button></div><div class="row topgap"><input id="search" placeholder="Cari pengirim atau subjek"><button id="searchBtn" class="secondary">Cari</button></div><div id="messages" class="empty">Pilih salah satu alamat email.</div><div id="detail" class="topgap"></div></section></div>
</section></main>
<script>
(function(){
let adminKey='',selectedAddress='';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opts){opts=opts||{};opts.headers=Object.assign({},opts.headers||{},{Authorization:'Bearer '+adminKey});if(opts.body)opts.headers['Content-Type']='application/json';const r=await fetch(path,opts);let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
function message(text,error){$('loginMsg').innerHTML='<div class="notice '+(error?'error':'')+'">'+esc(text)+'</div>'}
async function login(){adminKey=$('key').value.trim();if(!adminKey){message('Masukkan kunci admin.',true);return}try{await api('/admin/mailboxes');$('login').classList.add('hidden');$('app').classList.remove('hidden');$('loginMsg').innerHTML='';await loadMailboxes()}catch(e){adminKey='';message('Kunci ditolak atau server bermasalah: '+e.message,true)}}
async function loadMailboxes(){const d=await api('/admin/mailboxes');const list=d.mailboxes||[];$('mailboxes').innerHTML=list.length?list.map(m=>'<button class="mailbox '+(m.address===selectedAddress?'active':'')+'" data-address="'+esc(m.address)+'"><strong>'+esc(m.address)+'</strong><small>'+esc(m.mailbox_type==='support'?'Support — admin only':(m.game_code||'game').toUpperCase())+' · '+(m.is_active?'Aktif':'Nonaktif')+'</small></button>').join(''):'<div class="empty">Belum ada alamat email.</div>';document.querySelectorAll('.mailbox').forEach(b=>b.addEventListener('click',()=>selectMailbox(b.dataset.address)))}
async function createMailbox(){try{$('createBtn').disabled=true;const v=$('kind').value;const body=v==='support'?{type:'support'}:{game:v};const d=await api('/admin/mailboxes',{method:'POST',body:JSON.stringify(body)});$('createResult').innerHTML='<div class="notice"><strong>Alamat dibuat: '+esc(d.address)+'</strong>'+(d.accessToken?'<p>Token akses pembeli (hanya ditampilkan sekali):</p><pre>'+esc(d.accessToken)+'</pre><button class="secondary" id="copyToken">Salin token</button><p class="muted">Simpan token ini secara aman dan berikan hanya kepada pembeli yang berhak.</p>':'<p>'+esc(d.note||'')+'</p>')+'</div>';if(d.accessToken)$('copyToken').onclick=()=>navigator.clipboard.writeText(d.accessToken);await loadMailboxes();if(d.address)await selectMailbox(d.address)}catch(e){$('createResult').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}finally{$('createBtn').disabled=false}}
async function rotateToken(){
if(!selectedAddress){$('createResult').innerHTML='<div class="notice error">Pilih alamat email terlebih dahulu.</div>';return}
if(!confirm('Ganti token akses untuk '+selectedAddress+'? Token lama akan langsung tidak berlaku.'))return;
try{
$('rotateTokenBtn').disabled=true;
const d=await api('/admin/mailboxes/rotate-token',{method:'POST',body:JSON.stringify({address:selectedAddress})});
$('createResult').innerHTML='<div class="notice"><strong>Token baru untuk '+esc(d.address)+':</strong><pre>'+esc(d.accessToken)+'</pre><button class="secondary" id="copyRotatedToken">Salin token baru</button><p class="muted">Token lama sudah tidak berlaku. Simpan token baru dan berikan hanya kepada pembeli yang berhak. Token hanya ditampilkan sekali.</p></div>';
$('copyRotatedToken').onclick=()=>navigator.clipboard.writeText(d.accessToken);
}catch(e){$('createResult').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}
finally{$('rotateTokenBtn').disabled=false}
}
async function selectMailbox(address){selectedAddress=address;$('selectedTitle').textContent=address;$('selectedSub').textContent='Email masuk untuk alamat ini';await loadMailboxes();await loadMessages()}
async function loadMessages(){if(!selectedAddress)return;try{const q=encodeURIComponent($('search').value.trim());const d=await api('/admin/messages?address='+encodeURIComponent(selectedAddress)+'&q='+q);const arr=d.messages||[];$('messages').innerHTML=arr.length?arr.map(m=>'<div class="message" data-id="'+esc(m.id)+'"><strong>'+esc(m.subject||'(Tanpa subjek)')+'</strong><small>'+esc(m.sender)+' · '+esc(new Date(m.received_at).toLocaleString('id-ID'))+'</small>'+(m.otp_code?'<div class="otp" style="font-size:18px">'+esc(m.otp_code)+'</div>':'')+'</div>').join(''):'<div class="empty">Inbox masih kosong.</div>';document.querySelectorAll('.message').forEach(el=>el.addEventListener('click',()=>readMessage(el.dataset.id)))}catch(e){$('messages').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
async function readMessage(id){try{const m=await api('/admin/messages/'+encodeURIComponent(id)+'?address='+encodeURIComponent(selectedAddress));$('detail').innerHTML='<div class="card"><div class="muted">DARI</div><strong>'+esc(m.sender)+'</strong><p class="muted">'+esc(m.received_at)+'</p><h3>'+esc(m.subject||'(Tanpa subjek)')+'</h3>'+(m.otp_code?'<div class="muted">KODE TERDETEKSI</div><div class="otp">'+esc(m.otp_code)+'</div>':'')+'<pre>'+esc(m.body_text||'(Email tidak memiliki teks biasa.)')+'</pre><div class="muted">Lampiran: '+((m.attachments||[]).length)+' · Penyimpanan lampiran belum diaktifkan.</div></div>'}catch(e){$('detail').innerHTML='<div class="notice error">'+esc(e.message)+'</div>'}}
$('loginBtn').onclick=login;$('key').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('createBtn').onclick=createMailbox;$('refreshBtn').onclick=()=>loadMailboxes().catch(e=>alert(e.message));$('refreshMessages').onclick=()=>loadMessages();$('rotateTokenBtn').onclick=rotateToken;$('searchBtn').onclick=()=>loadMessages();$('logoutBtn').onclick=()=>{adminKey='';selectedAddress='';$('key').value='';$('app').classList.add('hidden');$('login').classList.remove('hidden');$('createResult').innerHTML='';$('detail').innerHTML=''};
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
    let response;

    if (url.pathname === "/inbox" && request.method === "GET") {
      response = new Response(BUYER_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    } else if (url.pathname === "/panel" && request.method === "GET") {
      response = new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    } else if (url.pathname === "/health" && request.method === "GET") {
      response = json({ ok: true, service: "xeravion-mail", status: "worker-online" });
    } else if (url.pathname === "/admin/mailboxes/rotate-token" && request.method === "POST") {
      response = await rotateMailboxToken(request, env);
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
    } else if (url.pathname.startsWith("/admin/attachments/") && request.method === "GET") {
      const parts = url.pathname.split("/");
      response = await adminAttachmentResponse(request, env, url, parts[3], parts[4]);
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
