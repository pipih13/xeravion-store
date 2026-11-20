/**
 * XERAVION → Google Sheets sales ledger
 * 1) Create a Google Sheet and copy its spreadsheet ID.
 * 2) Paste this file into Extensions → Apps Script.
 * 3) Set SPREADSHEET_ID and SHARED_SECRET below.
 * 4) Deploy as Web app: Execute as Me; access: Anyone.
 * The endpoint only accepts signed requests from the XERAVION Supabase Edge Function.
 */
const SPREADSHEET_ID = 'GANTI_DENGAN_ID_GOOGLE_SHEET';
const SHARED_SECRET = 'GANTI_DENGAN_SECRET_ACAK_MINIMAL_32_KARAKTER';
const SHEET_NAME = 'Penjualan';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!constantTimeEquals_(String(body.secret || ''), SHARED_SECRET)) {
      return json_({ success: false, error: 'Unauthorized' });
    }
    const order = body.order || {};
    if (!order.invoice_number) throw new Error('Nomor invoice tidak ditemukan.');
    if (order.payment_status !== 'paid' || order.order_status !== 'completed') {
      throw new Error('Hanya pesanan lunas dan selesai yang boleh dicatat.');
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
    const headers = [
      'Tanggal', 'Invoice', 'Nama Pembeli', 'Email Pembeli', 'Game',
      'Kode Listing', 'Nama Listing', 'Metode Pembayaran', 'Harga Normal (Rp)',
      'Diskon Poin (Rp)', 'Pendapatan Diterima (Rp)', 'Modal (Rp)',
      'Laba Kotor (Rp)', 'Status Pembayaran', 'Status Pesanan', 'Terakhir Sinkron'
    ];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    } else if (sheet.getRange(1, 1, 1, headers.length).getValues()[0][1] !== 'Invoice') {
      throw new Error('Format header sheet tidak sesuai. Gunakan sheet Penjualan yang kosong.');
    }

    const invoice = String(order.invoice_number);
    const lastRow = sheet.getLastRow();
    let targetRow = 0;
    if (lastRow >= 2) {
      const found = sheet.getRange(2, 2, lastRow - 1, 1)
        .createTextFinder(invoice).matchEntireCell(true).findNext();
      if (found) targetRow = found.getRow();
    }

    const costKnown = order.cost_price !== null && order.cost_price !== undefined;
    const cost = costKnown ? Number(order.cost_price) : null;
    const revenue = Number(order.amount_due || 0);
    const profit = costKnown ? revenue - cost : '';
    const values = [[
      order.created_at ? new Date(order.created_at) : new Date(),
      invoice,
      safeCell_(order.buyer_name),
      safeCell_(order.buyer_email),
      safeCell_(order.game),
      safeCell_(order.product_code),
      safeCell_(order.product_name),
      safeCell_(order.payment_method),
      Number(order.item_price || 0),
      Number(order.points_discount || 0),
      revenue,
      costKnown ? cost : '',
      profit,
      order.payment_status,
      order.order_status,
      new Date()
    ]];
    if (targetRow) sheet.getRange(targetRow, 1, 1, headers.length).setValues(values);
    else sheet.appendRow(values[0]);

    return json_({ success: true, invoice_number: invoice, action: targetRow ? 'updated' : 'inserted' });
  } catch (err) {
    return json_({ success: false, error: String(err && err.message || err) });
  }
}

function constantTimeEquals_(a, b) {
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeCell_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+@\-]/.test(text) ? "'" + text : text;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
