# LINE LIFF customer login setup

The customer storefront uses the existing LINE Login channel **2012679988** and its existing LIFF app ID **2012679988-ORHhLD7I**. Do not create a new channel or LIFF app.

## LINE Developers Console

In the existing LINE Login channel:

1. Open the **LIFF** tab and confirm the existing LIFF app ID is `2012679988-ORHhLD7I`.
2. Set the LIFF app Endpoint URL to the exact customer storefront page:
   `https://cafe-order-web-admin-portal.github.io/Line-Order/cafe-amazon-liff-index.html`
3. Enable the `openid` and `profile` scopes.
4. Confirm the LIFF app is active.

## LINE Official Account Rich Menu

Set the order button's URI action to the LIFF URL:

`https://liff.line.me/2012679988-ORHhLD7I`

Do not point the Rich Menu directly to the GitHub Pages URL or to the old OAuth authorization page. The LIFF URL is what launches the LIFF app in LINE.

## Supabase

The `line-login` Edge Function verifies the ID token issued by LIFF against LINE's verify endpoint using channel ID `2012679988`, then creates or updates the matching `customers` row. It uses the existing server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets.

The old OAuth-only secrets `LINE_LOGIN_CHANNEL_SECRET` and `LINE_LOGIN_REDIRECT_URI` are no longer required by the LIFF flow. They may remain in Supabase Secrets; the function does not read them.

## Customer login flow

1. Customer taps the Rich Menu order action.
2. LINE opens `https://liff.line.me/2012679988-ORHhLD7I`.
3. LIFF SDK initializes in the customer page.
4. In a LIFF browser, LINE provides the logged-in user's LIFF session. No separate email/password login page is shown.
5. The browser sends the LIFF ID token to the `line-login` Edge Function.
6. The Edge Function verifies the token with LINE and creates/updates `customers` without overwriting the customer's phone number.
7. The storefront loads the menu and existing ordering/tracking features.

The app requests `openid` and `profile`. The server verifies the ID token; it does not trust a user ID or profile object supplied separately by the browser.

## Testing

Test by opening the LIFF URL from the actual LINE Official Account Rich Menu on iOS and Android. Confirm:
- It opens in LINE's LIFF browser.
- It does not show the separate LINE email/password OAuth page.
- Customer identity is verified and the customer row is created/updated.
- Menu, checkout, order tracking, and optional location sharing continue to work.

If a customer opens the GitHub Pages URL directly in Safari/Chrome, behavior may differ from opening the LIFF URL inside LINE.
