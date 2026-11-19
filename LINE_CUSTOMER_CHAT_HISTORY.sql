-- LINE customer chat history capture (forward-looking only).
-- LINE Messaging API webhook delivers events from activation onward; older chats
-- are not available for API backfill.

BEGIN;

CREATE TABLE IF NOT EXISTS public.line_chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_key text NOT NULL UNIQUE,
    branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
    line_user_id text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound','outbound','system')),
    event_type text NOT NULL DEFAULT 'message',
    message_type text NULL,
    message_text text NULL,
    line_message_id text NULL,
    event_timestamp timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_chat_messages_branch_user_created
    ON public.line_chat_messages (branch_id, line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_chat_messages_user_created
    ON public.line_chat_messages (line_user_id, created_at DESC);

ALTER TABLE public.line_chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.line_chat_messages FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.line_chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.line_chat_messages TO service_role;

DROP POLICY IF EXISTS line_chat_messages_staff_read ON public.line_chat_messages;
CREATE POLICY line_chat_messages_staff_read
ON public.line_chat_messages
FOR SELECT TO authenticated
USING (
    private.is_active_staff()
    AND (
        private.is_super_admin()
        OR (
            branch_id IS NOT NULL
            AND branch_id = private.current_staff_branch_id()
        )
    )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
