# LINE Customer Login and Chat History

## LINE Login

The customer LIFF page uses the LINE LIFF ID-token flow. It obtains an ID token from the LIFF SDK and posts it to the Supabase Edge Function `line-login`, which verifies the token with LINE's `/oauth2/v2.1/verify` endpoint against channel ID `2012679988`.

- LIFF ID: `2012679988-ORHhLD7I`
- Required LIFF scopes: `openid` and `profile`
- The current ID-token verification flow does not exchange an authorization code and does not require a LINE Login channel secret.
- Keep the LINE channel ID in the Edge Function consistent with the channel that owns the LIFF app.

## LINE Messaging API Webhook

Webhook endpoint:

`https://ytxbnqosenolojifeikf.supabase.co/functions/v1/line-webhook`

Required Edge Function secrets:
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not expose these values in browser code.

Enable **Use webhook** in the LINE Developers Messaging API channel and verify the webhook URL. The function verifies `x-line-signature` before processing events.

## Chat history

The webhook and order-notification functions now write customer-facing conversation events to `public.line_chat_messages`:
- Incoming text messages and incoming event types.
- Automatic text replies sent by the webhook.
- Order-created notifications sent to the customer.
- Order-status Flex notifications sent to the customer.

Image, video, audio and file events are recorded by message type only; the media binary is not downloaded or stored.

The Web Admin Portal displays the conversation history under **ข้อมูลลูกค้า LINE**. Super Admin can view all records. Active staff can only read records assigned to their branch through RLS.

### Important: historical backfill

LINE Messaging API does not provide a general endpoint to download arbitrary past one-to-one chat history. The database therefore starts collecting events from the point this webhook logging was deployed and receives events that LINE delivers after webhook activation. Older conversations cannot be recreated by this change unless they were already stored or exported elsewhere.

### Branch mapping

The current project has one active branch, so the webhook resolves that branch automatically. When the deployment uses separate LINE Official Accounts per branch and more than one branch is active, set the Edge Function secret `LINE_BRANCH_CODE` to the matching branch code for each webhook deployment. Without a unique branch mapping, chat events are stored with a null branch and are visible only to Super Admin.

## Verification checklist

1. Confirm the LINE Developers Messaging API channel uses the webhook URL above.
2. Enable **Use webhook** and complete LINE's webhook verification.
3. Send a new text message from a LINE user.
4. Confirm a new row appears in `public.line_chat_messages`.
5. Sign in as a branch Manager and confirm the matching conversation appears in **ข้อมูลลูกค้า LINE**.
6. Create a test order and update its status to confirm the outbound notifications are added to the same conversation.
