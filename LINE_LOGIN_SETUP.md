# LINE Login deployment checklist

This project uses the existing LINE Login channel **2012679988**. Do not create a replacement channel.

## Supabase Edge Function secrets

In Supabase Dashboard → Project Settings → Edge Functions → Secrets, add:

- `LINE_LOGIN_CHANNEL_SECRET`: the Channel secret from LINE Developers Console for channel 2012679988.
- `LINE_LOGIN_REDIRECT_URI`: the exact callback URL used by the customer storefront. With standard GitHub Pages project hosting for the current repository, the expected URL is `https://cafe-order-web-admin-portal.github.io/Line-Order/cafe-amazon-liff-index.html`. Confirm the actual deployed page URL first; if Pages uses a custom domain or another path, use that exact full URL instead. The frontend derives the callback from `window.location.origin + window.location.pathname`.

The existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must remain configured server-side. Never place these secrets in `assets/config.js` or browser code.

## LINE Developers Console

For the same LINE Login channel, add the exact value of `LINE_LOGIN_REDIRECT_URI` to the channel's Callback URL list. Enable the `openid` and `profile` scopes. The app uses Authorization Code Flow with PKCE (S256), state and nonce validation.

## Publish and test

1. Enable GitHub Pages for this repository/branch and confirm the customer page is served at the intended HTTPS URL.
2. Set `LINE_LOGIN_REDIRECT_URI` to that exact customer page URL and allowlist the same URL in LINE Developers Console.
3. Confirm `LINE_LOGIN_CHANNEL_SECRET` is saved in Supabase Edge Function Secrets.
4. Open the customer page in a private browser session. Confirm LINE-hosted login, customer row creation in `public.customers`, menu loading, test order, order tracking and explicit GPS sharing.
5. Test GPS denial: ordering and tracking must continue to work without location access.

## GPS behavior

GPS is never requested on page load. A browser-native location permission prompt is triggered only after the customer presses a share-location button. Web geolocation updates are available only while the page remains open and active; background/closed-page tracking is not guaranteed.

## Rollback

The previous LIFF frontend is retained on the default branch until this branch is reviewed and merged. Existing Edge Function CORS allowlists retain the previous origin and add the new requested origin.
