# HANDOFF — Line-Order Payment Operations

Updated: 2026-11-23

## Current deployment
- Supabase project: `ytxbnqosenolojifeikf`
- `payment-portal`: v8 ACTIVE
- `line-webhook`: v31 ACTIVE
- `update-order-status`: v21 ACTIVE

## Changes in this handoff
1. QR Payment Settings now supports selecting and saving a branch-specific PromptPay QR image. Uploads are stored in the public `payment-qr` bucket; the saved URL is written to `payment_settings.qr_image_url`.
2. Fixed the payment page event binder recursion and connected it to the normal page event binding. This restores Payment Settings and Transactions interactions.
3. LINE slip matching now excludes cancelled and completed orders. Cancelling an order expires its still-open `awaiting_payment` / `rejected` transaction and records an audit event.
4. Added a QR Payment queue to LIVE ORDERS, with payment status visible on each order card and all payment transactions accessible even when their related order is cancelled.
5. The six historical B0001 transactions for the tested LINE customer whose orders were already cancelled were changed from `awaiting_payment` to `expired`. Their order records remain cancelled; no payment was marked as received.

## Validation
- LIVE ORDERS inline JavaScript syntax: passed.
- Web Admin Portal `assets/app.js` syntax: passed.
- Payment Portal, LINE Webhook and Update Order Status deployed and ACTIVE.
- Verified the six cancelled-order payment sessions are now `expired`.
- No customer order or bank payment was created as part of the code test.

## Remaining manual validation
- Open Web Admin Portal > Payment Settings, upload a known-good PromptPay QR image, press **บันทึก QR**, then reload and verify it persists.
- Open LIVE ORDERS > **QR Payment** and verify all transaction rows display.
- Create one new test order, confirm **รอชำระเงิน** appears in LIVE ORDERS, send the transfer slip in LINE OA, and confirm it appears in the payment queue as **รอตรวจสอบสลิป**. Staff must still verify the real bank credit before marking Paid.
