-- Multi-branch LINE Login / LIFF / Messaging API registry.
-- Existing LIFFs map to one LINE Login Channel; one Login Channel maps to one branch.
-- A different branch must use a distinct LINE Login Channel ID.

BEGIN;

CREATE TABLE IF NOT EXISTS public.line_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  line_login_channel_id text NOT NULL UNIQUE,
  line_messaging_channel_id text UNIQUE,
  channel_name text NOT NULL,
  webhook_secret_vault_id uuid NULL,
  channel_access_token_vault_id uuid NULL,
  use_legacy_env_credentials boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT line_channels_login_id_not_blank CHECK (length(btrim(line_login_channel_id)) > 0)
);

CREATE TABLE IF NOT EXISTS public.line_liff_apps (
  liff_id text PRIMARY KEY,
  line_login_channel_id text NOT NULL REFERENCES public.line_channels(line_login_channel_id) ON UPDATE CASCADE ON DELETE CASCADE,
  app_name text NOT NULL DEFAULT 'Customer Order',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT line_liff_apps_liff_id_not_blank CHECK (length(btrim(liff_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_line_channels_branch_active
  ON public.line_channels(branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_line_liff_apps_channel_active
  ON public.line_liff_apps(line_login_channel_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_liff_apps_one_default_per_channel
  ON public.line_liff_apps(line_login_channel_id)
  WHERE is_active IS TRUE AND is_default IS TRUE;

ALTER TABLE public.line_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_liff_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_channels, public.line_liff_apps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.line_channels, public.line_liff_apps TO service_role;

CREATE OR REPLACE FUNCTION public.get_line_messaging_configs()
RETURNS TABLE (
  line_login_channel_id text,
  line_messaging_channel_id text,
  branch_id uuid,
  branch_code text,
  branch_name text,
  liff_id text,
  webhook_secret text,
  channel_access_token text,
  use_legacy_env_credentials boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    c.line_login_channel_id,
    c.line_messaging_channel_id,
    b.id,
    b.branch_code,
    b.branch_name,
    l.liff_id,
    ws.decrypted_secret,
    at.decrypted_secret,
    c.use_legacy_env_credentials
  FROM public.line_channels AS c
  JOIN public.branches AS b ON b.id = c.branch_id
  LEFT JOIN LATERAL (
    SELECT app.liff_id
    FROM public.line_liff_apps AS app
    WHERE app.line_login_channel_id = c.line_login_channel_id
      AND app.is_active IS TRUE
    ORDER BY app.is_default DESC, app.created_at, app.liff_id
    LIMIT 1
  ) AS l ON TRUE
  LEFT JOIN vault.decrypted_secrets AS ws ON ws.id = c.webhook_secret_vault_id
  LEFT JOIN vault.decrypted_secrets AS at ON at.id = c.channel_access_token_vault_id
  WHERE c.is_active IS TRUE
    AND b.is_active IS TRUE;
$function$;

REVOKE ALL ON FUNCTION public.get_line_messaging_configs()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_line_messaging_configs()
TO service_role;

INSERT INTO public.line_channels (
  branch_id, line_login_channel_id, channel_name,
  use_legacy_env_credentials, is_active
)
SELECT b.id, '2012679988', 'Café Amazon ตลาดทวีสมาน', TRUE, TRUE
FROM public.branches AS b
WHERE b.branch_code = 'B0001'
ON CONFLICT (line_login_channel_id) DO UPDATE
SET branch_id = EXCLUDED.branch_id,
    channel_name = EXCLUDED.channel_name,
    use_legacy_env_credentials = TRUE,
    is_active = TRUE,
    updated_at = now();

INSERT INTO public.line_liff_apps (
  liff_id, line_login_channel_id, app_name, is_default, is_active
)
VALUES (
  '2012679988-ORHhLD7I', '2012679988',
  'Café Amazon ตลาดทวีสมาน - Customer Order', TRUE, TRUE
)
ON CONFLICT (liff_id) DO UPDATE
SET line_login_channel_id = EXCLUDED.line_login_channel_id,
    app_name = EXCLUDED.app_name,
    is_default = TRUE,
    is_active = TRUE;

COMMIT;
