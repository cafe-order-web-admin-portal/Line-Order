# Unified Theme Rollout — Safety & Rollback

## Scope in this first pass
- Adds a device-local theme token layer for the Web Admin Portal and LIVE Orders only.
- Adds a compact theme picker to the existing header area.
- Available themes: International, Classic, Forest (default/fallback), Espresso, Ocean, Charcoal, Terracotta and Dark.
- Theme selection is stored only in this browser's localStorage under `ca.unified.theme.v1`.
- Customer Order / Customer LIFF is explicitly out of scope and must remain unchanged.
- No Supabase schema, RLS, Edge Function, order state, order API, GPS, LINE SSO, route, or permission changes.

## Immediate rollback
1. Select **Classic** in the Theme picker to restore the previous green/orange palette.
2. Or run `window.CafeAmazonTheme.reset()` in the browser console to restore the Forest fallback.
3. To preview a theme for one visit, add `?ca-theme=classic` (or another supported theme key) to the page URL.

## Code rollback
- All work is isolated to `feature/unified-theme-rollout`.
- Do not merge this branch into `main` until visual review and regression testing are complete.
- If the branch is rejected, close the draft PR and leave `main` untouched. Reverting the branch commits is not required to restore production because the branch is not deployed.

## Required checks before release
- Desktop and mobile layout for Web Admin Portal.
- Desktop and mobile layout for LIVE Orders, including map, GPS status, queue tabs and order action buttons.
- CMS-to-Line-Order SSO handoff.
- Login/logout, role-based access and branch scoping.
- Confirm theme changes do not alter order data or live updates.
- Confirm Customer Order / Customer LIFF remains unchanged.
