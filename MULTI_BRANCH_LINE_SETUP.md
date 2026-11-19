# Multi-Branch LINE Order Setup

## Customer experience

Customers do **not** select a branch in either the Rich Menu/LIFF order page or the website order page.

Each branch has its own LINE entry point. The system resolves the branch in the backend:

`LIFF ID → registered LINE Login Channel ID → branch_id → branch menu and prices → order`

The browser sends only its LIFF app ID and the LINE ID token. It does not send a customer-selected branch code. The server resolves the LIFF mapping and verifies the LINE ID token against the mapped channel before creating an order.

## Existing branch

The current mapping is already registered:

- Branch: `B0001` — สาขาตลาดทวีสมาน
- LINE Login Channel ID: `2012679988`
- LIFF ID: `2012679988-ORHhLD7I`

The existing branch continues to use the existing Edge Function secrets `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` through the legacy fallback setting.

## Important LINE platform constraint

A LINE ID token's `aud` claim identifies the **LINE Login Channel ID**, not an individual LIFF app ID. The server verifies this audience with LINE's Verify ID Token API.

Therefore:
- Multiple LIFF apps under the same LINE Login Channel can be registered, but they all map to the same branch.
- A separate branch needs its own LINE Login Channel ID, with its LIFF app registered under that channel.
- Do not register two different branches under the same LINE Login Channel ID. LINE ID tokens from those LIFF apps would have the same audience and cannot be securely distinguished as separate branches.

Official references:
- [LINE LIFF app ID and LIFF URL](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
- [LIFF URL and endpoint redirection](https://developers.line.biz/en/docs/liff/opening-liff-app/)
- [LIFF SDK `liff.id`](https://developers.line.biz/en/reference/liff/)
- [Verify ID token and expected channel ID](https://developers.line.biz/en/reference/line-login/#verify-id-token)

## Add a new branch

1. Create the branch in the Web Admin / branch master first. Confirm it has an active row in `public.branches` and has products/prices in `public.branch_products`.
2. In LINE Developers, create a dedicated LINE Login Channel for this branch. Link the matching LINE Official Account/Messaging API channel under the same provider as required by your LINE account setup.
3. Add a LIFF app under that Login Channel. Enable `openid` and `profile` scopes.
4. Set the LIFF Endpoint URL to:

   `https://cafe-order-web-admin-portal.github.io/Line-Order/cafe-amazon-liff-index.html?liff_id=YOUR_NEW_LIFF_ID`

5. In that branch's Rich Menu, set the order link to:

   `https://liff.line.me/YOUR_NEW_LIFF_ID`

6. For direct website ordering, use the branch-specific link:

   `https://cafe-order-web-admin-portal.github.io/Line-Order/web-order.html?liff_id=YOUR_NEW_LIFF_ID`

7. In the LINE Messaging API channel, enable **Use webhook** and set the webhook URL to:

   `https://ytxbnqosenolojifeikf.supabase.co/functions/v1/line-webhook`

8. Run `ADD_NEW_BRANCH_LINE_CHANNEL.sql` after replacing its placeholders. This stores the new channel secret and long-lived access token in Supabase Vault and registers the LINE Channel/LIFF-to-branch mapping. The same webhook endpoint can then identify multiple Official Accounts by validating each request's signature against the registered Vault secret.

9. Verify that the final SELECT in the SQL script returns the correct branch, login channel, messaging channel and LIFF ID.

## What is configured automatically

Once a channel and LIFF ID are registered:
- The LIFF page loads only the mapped branch's menu and prices.
- The customer does not see a branch selector.
- Checkout uses the server-resolved branch; the customer cannot override it with a posted branch code.
- Order tracking and location sharing are scoped to the branch mapped to that LIFF app.
- Order confirmation and status messages use the Messaging API access token configured for that branch.
- The central webhook receives multiple OAs, verifies the matching channel secret from Vault, and logs conversations against the correct branch.

## Adding another LIFF app to an existing branch

If the new LIFF app belongs to the **same branch**, insert another row into `public.line_liff_apps` with the same `line_login_channel_id` and a new `liff_id`. Set `is_default = false` unless it should become the branch's default link used in webhook replies.

Do not reuse one Login Channel ID to route customers to two different branches.
