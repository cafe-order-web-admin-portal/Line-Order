# Unified Theme Rollout — Safety & Rollback

## Scope in this first pass
- Adds a device-local theme token layer for the Web Admin Portal and LIVE Orders.
- Adds a compact theme picker to the existing header area.
- Available themes: International (default), Classic, Forest, Espresso, Dark.
- Theme selection is stored only in this browser's localStorage under `ca.unified.theme.v1`.
- No Supabase schema, RLS, Edge Function, order state, order API, GPS, LINE SSO, route, or permission changes.

## Immediate rollback
1. Select **Classic** in the Theme picker to restore the previous green/orange palette.
2. Or run `window.CafeAmazonTheme.reset()` in the browser console to restore the International default.
3. To bypass the saved selection for a one-off check, add `?ca-theme=classic` to the page URL.

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
