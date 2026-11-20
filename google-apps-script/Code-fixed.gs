/**
 * XERAVION → Google Sheets sales ledger
 * 1) Create a Google Sheet and copy its spreadsheet ID.
 * 2) Paste this file into Extensions → Apps Script.
 * 3) Set SPREADSHEET_ID below and add the shared secret in Script Properties.
 * 4) Deploy as Web app: Execute as Me; access: Anyone.
 * The endpoint only accepts signed requests from the XERAVION Supabase Edge Function.
 */
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('XERAVION_SPREADSHEET_ID') || '';
const SHARED_SECRET = PropertiesService.getScriptProperties().getProperty('XERAVION_SYNC_SECRET') || '';
const SHEET_NAME = 'Penjualan';

function doPost(e) {
  try {
    if (!SPREADSHEET_ID) throw new Error('Script Property XERAVION_SPREADSHEET_ID belum diatur.');
    if (!SHARED_SECRET) throw new Error('Script Property XERAVION_SYNC_SECRET belum diatur.');
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!constantTimeEquals_(String(body.secret || ''), SHARED_SECRET)) {
      return json_({ success: false, error: 'Unauthorized' });
    }
    const order = body.order || {};
    if (!order.invoice_number) throw new Error('Nomor invoice tidak ditemukan.');
    const isCompletedSale = order.payment_status === 'paid' && order.order_status === 'completed';
    const isReversal = order.order_status === 'cancelled' || order.payment_status === 'refunded';
    if (!isCompletedSale && !isReversal) {
      throw new Error('Hanya pesanan selesai atau pembatalan/refund yang boleh disinkronkan.');
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
    if (isReversal && !targetRow) {
      return json_({ success: true, invoice_number: invoice, action: 'skipped_no_prior_sale' });
    }

    const costKnown = isCompletedSale && order.cost_price !== null && order.cost_price !== undefined;
    const cost = costKnown ? Number(order.cost_price) : null;
    const revenue = isCompletedSale ? Number(order.amount_due || 0) : 0;
    const profit = isCompletedSale && costKnown ? revenue - cost : '';
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
