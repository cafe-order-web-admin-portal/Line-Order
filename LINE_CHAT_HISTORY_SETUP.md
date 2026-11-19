# LINE Customer Login and Chat History

## Customer-facing branch behavior

Customers never select a branch in the LIFF order page or website order page. Each branch has its own LINE entry point. The system resolves the branch from the registered LIFF ID and its LINE Login Channel mapping.

## LINE Login

The existing branch mapping is:

- Branch: `B0001` — สาขาตลาดทวีสมาน
- LINE Login Channel ID: `2012679988`
- LIFF ID: `2012679988-ORHhLD7I`

The customer LIFF page posts the raw ID token and LIFF ID to the Supabase Edge Function `line-login`. The function reads the registered LIFF-to-channel-to-branch mapping from the database, then verifies the ID token against the mapped LINE Login Channel ID using LINE's `/oauth2/v2.1/verify` endpoint.

The browser does not send a branch code. Checkout, order history and location sharing use the same server-side branch mapping.

## LINE Messaging API Webhook

Webhook endpoint:

`https://ytxbnqosenolojifeikf.supabase.co/functions/v1/line-webhook`

The endpoint supports multiple LINE Official Accounts. It validates each incoming `x-line-signature` against the channel secret saved in Supabase Vault, then resolves the correct branch, LIFF URL and Messaging API access token.

The original B0001 integration continues to use the existing Edge Function secrets `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`. New branches should store their channel secret and access token in Vault and register their channel mapping using `ADD_NEW_BRANCH_LINE_CHANNEL.sql`.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never expose these values in browser code.

## Chat history

The webhook and order-notification functions write customer-facing conversation events to `public.line_chat_messages`:
- Incoming text messages and incoming event types.
- Automatic text replies sent by the webhook.
- Order-created notifications sent to the customer.
- Order-status Flex notifications sent to the customer.
- LINE unsend events, which remove the stored content of the unsent message.

Image, video, audio and file events are recorded by message type only; the media binary is not downloaded or stored.

The Web Admin Portal displays conversation history under **ข้อมูลลูกค้า LINE**. Super Admin can view all records. Active staff can only read records assigned to their branch through RLS.

## Historical backfill limitation

LINE Messaging API does not provide a general endpoint to download arbitrary past one-to-one chat history. The database starts collecting events when webhook logging is enabled and can store events delivered after activation. Older conversations cannot be recreated by this change unless they were already stored or exported elsewhere.

## New branch setup

Follow `MULTI_BRANCH_LINE_SETUP.md` and run `ADD_NEW_BRANCH_LINE_CHANNEL.sql` after replacing the placeholders. The shared webhook endpoint can then receive the new OA's events and store them against the configured branch.

## Verification checklist

1. Confirm the correct LINE Login Channel and LIFF app are registered against the branch.
2. Confirm the LIFF Endpoint URL contains `?liff_id=YOUR_LIFF_ID`.
3. Confirm the LINE Developers Messaging API channel uses the shared webhook URL.
4. Enable **Use webhook** and complete LINE's webhook verification.
5. Send a new text message from the LINE Official Account.
6. Confirm a new row appears in `public.line_chat_messages` with the matching branch.
7. Sign in as a branch Manager and confirm the matching conversation appears in **ข้อมูลลูกค้า LINE**.
8. Create a test order and update its status to confirm outbound notifications are added to that same branch conversation.
