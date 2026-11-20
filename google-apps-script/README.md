# XERAVION Google Sheets accounting setup

This integration records only orders with `payment_status = paid` and `order_status = completed`. It uses the invoice number as an idempotency key, so retrying a sync updates the same row instead of creating duplicate sales.

## 1. Create the spreadsheet

Create a blank Google Sheet. The Apps Script creates a tab named `Penjualan` automatically.

## 2. Add the Apps Script

1. Open the spreadsheet.
2. Choose **Extensions → Apps Script**.
3. Replace the starter code with the contents of [Code.gs](./Code.gs).
4. In Apps Script, open **Project Settings → Script Properties → Add script property**.
5. Add property name `XERAVION_SYNC_SECRET` and value a new random secret of at least 32 characters. Do not share it publicly or commit it to GitHub.

## 3. Deploy the web app

1. Choose **Deploy → New deployment → Web app**.
2. Execute as: **Me**.
3. Who has access: **Anyone** (the endpoint checks the shared secret on every POST).
4. Deploy and authorize the script.
5. Copy the Web app URL. It must end in `/exec`.

## 4. Configure Supabase Edge Function secrets

In Supabase Dashboard → **Edge Functions → Secrets**, add:

- `GOOGLE_SHEETS_WEB_APP_URL`: the Web app URL ending in `/exec`
- `XERAVION_ACCOUNTING_SYNC_SECRET`: exactly the same random secret saved in Apps Script Script Properties

Do not put the secret in the website code, GitHub, or a public message.

## 5. Test

After the secrets are saved and the website deploy has finished, use the admin dashboard to mark a test order **Lunas & selesai**. A successful run appends a row in `Penjualan`. Retrying the same order updates the existing invoice row.

## Notes

- Modal/cost is stored in admin-only Supabase tables and is not exposed in the public catalog.
- New orders snapshot the modal recorded on the product at the time the order is created.
- Existing orders from before this integration may have no modal snapshot; their historical profit is intentionally left unknown rather than guessed.
- Profit shown is gross profit (amount actually paid minus modal), before other operating expenses.
- If a sheet sync fails, the order remains completed and the admin message reports the sync error. After correcting the secrets or deployment, use **Sinkronkan pembukuan** beside the order in the admin order list to retry. The sheet uses invoice upsert, so it updates the same row instead of duplicating it. If a completed order is later cancelled/refunded, its existing row is updated and its revenue/profit cells are cleared; a cancelled order that was never recorded is skipped.
