# LINE LIFF customer login setup

The customer order pages are multi-branch. Customers do not select a branch. Each branch is opened from its own LIFF URL, and the backend maps the LIFF app to its registered LINE Login Channel and branch.

## Existing B0001 branch

- Branch: `B0001` — สาขาตลาดทวีสมาน
- LINE Login Channel ID: `2012679988`
- LIFF ID: `2012679988-ORHhLD7I`

The existing LIFF app remains active. Its endpoint can continue using the existing default LIFF ID. The registry row was added to `public.line_channels` and `public.line_liff_apps`.

## Adding a branch

Follow `MULTI_BRANCH_LINE_SETUP.md` and `ADD_NEW_BRANCH_LINE_CHANNEL.sql`.

Important: a LINE ID token's `aud` claim identifies the LINE Login Channel ID, not an individual LIFF app. A single LINE Login Channel can host multiple LIFF apps for the same branch, but cannot securely distinguish two different branches. Use a separate LINE Login Channel ID for each branch.

## LIFF endpoint configuration

For each new LIFF app, set the Endpoint URL to:

`https://cafe-order-web-admin-portal.github.io/Line-Order/cafe-amazon-liff-index.html?liff_id=YOUR_LIFF_ID`

Enable the `openid` and `profile` scopes and confirm the LIFF app is active.

## Customer entry links

Rich Menu order action:

`https://liff.line.me/YOUR_LIFF_ID`

Direct website order link:

`https://cafe-order-web-admin-portal.github.io/Line-Order/web-order.html?liff_id=YOUR_LIFF_ID`

The same shared storefront and website code is used by all branches. The LIFF ID selects the registered branch configuration; there is no branch-selection UI.

## Authentication and security

The customer LIFF page obtains the raw ID token from `liff.getIDToken()` and posts it with the LIFF ID to the `line-login` Edge Function. The function:
1. Finds the registered LIFF app.
2. Resolves its LINE Login Channel and active branch.
3. Verifies the token with LINE against the mapped channel ID.
4. Creates or updates the customer's record.
5. Returns the server-resolved branch ID, branch code and branch name for menu display.

Checkout, order history and location-sharing functions repeat the server-side LIFF/channel/branch resolution. Customer-submitted branch codes are not accepted as the source of truth.

The current ID-token flow does not exchange an authorization code and does not require a LINE Login channel secret. Messaging API channel secrets and access tokens are separate credentials; new branches store them in Supabase Vault using the SQL setup template.
