# Café Amazon Customer Tracker (Native)

Native iOS/Android companion app for consent-based order location sharing. This is the native app foundation; it is not yet a store-installable release.

## Capabilities planned
- Explicit per-order location consent and stop-sharing control.
- Background location task while OS permissions allow it.
- Reuse the existing `share-customer-location` Supabase Edge Function contract (`id_token`, `liff_id`, `order_id`, `action`, coordinates).
- Staff continue using the existing Orders map.

## Important integration gates
1. Implement native LINE Login and obtain a LINE ID token. The existing LIFF token flow is browser-only and cannot be assumed to work in a standalone app.
2. Configure EAS project ID and iOS bundle signing / Apple Developer account, plus Android application signing.
3. Verify the Edge Function accepts the native LINE token audience/client ID. If not, extend its allow-listed client IDs securely; never put a service-role key in the app.
4. Test background permission behavior on physical iOS and Android devices. iOS may suspend background updates; no app can guarantee uninterrupted GPS.

## Run
`npm install` then `npx expo start`.

Do not distribute until LINE authentication, backend validation, privacy consent text, and physical-device tests are complete.
