-- TEMPLATE: register one new branch's LINE Login channel + Messaging API channel.
-- Replace every placeholder before running. Run only after the branch record exists.
--
-- Security model:
--   * One LINE Login Channel ID maps to exactly one branch.
--   * Multiple LIFF apps may map to that same branch/channel.
--   * Each additional branch must use its own LINE Login Channel ID.
--   * Messaging API Channel Secret and long-lived access token are saved in Supabase Vault.
--
-- Do not put channel secrets or access tokens in browser config files or GitHub.

DO $setup$
DECLARE
  v_branch_code text := 'REPLACE_WITH_BRANCH_CODE';
  v_line_login_channel_id text := 'REPLACE_WITH_LINE_LOGIN_CHANNEL_ID';
  v_line_messaging_channel_id text := 'REPLACE_WITH_MESSAGING_API_CHANNEL_ID';
  v_liff_id text := 'REPLACE_WITH_LIFF_ID';
  v_channel_name text := 'REPLACE_WITH_BRANCH_DISPLAY_NAME';
  v_channel_secret text := 'PASTE_LINE_MESSAGING_CHANNEL_SECRET_HERE';
  v_channel_access_token text := 'PASTE_LONG_LIVED_CHANNEL_ACCESS_TOKEN_HERE';
  v_branch_id uuid;
  v_webhook_secret_id uuid;
  v_access_token_secret_id uuid;
BEGIN
  SELECT b.id INTO v_branch_id
  FROM public.branches AS b
  WHERE b.branch_code = v_branch_code
    AND b.is_active IS TRUE;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Active branch % was not found in public.branches', v_branch_code;
  END IF;

  IF v_line_login_channel_id LIKE 'REPLACE_%'
     OR v_line_messaging_channel_id LIKE 'REPLACE_%'
     OR v_liff_id LIKE 'REPLACE_%'
     OR v_channel_secret LIKE 'PASTE_%'
     OR v_channel_access_token LIKE 'PASTE_%' THEN
    RAISE EXCEPTION 'Replace all LINE integration placeholders before running this script';
  END IF;

  v_webhook_secret_id := vault.create_secret(
    v_channel_secret,
    'line_webhook_secret_' || v_branch_code,
    'LINE Messaging API channel secret for ' || v_channel_name
  );

  v_access_token_secret_id := vault.create_secret(
    v_channel_access_token,
    'line_channel_access_token_' || v_branch_code,
    'LINE Messaging API long-lived access token for ' || v_channel_name
  );

  INSERT INTO public.line_channels (
    branch_id,
    line_login_channel_id,
    line_messaging_channel_id,
    channel_name,
    webhook_secret_vault_id,
    channel_access_token_vault_id,
    use_legacy_env_credentials,
    is_active
  )
  VALUES (
    v_branch_id,
    v_line_login_channel_id,
    v_line_messaging_channel_id,
    v_channel_name,
    v_webhook_secret_id,
    v_access_token_secret_id,
    FALSE,
    TRUE
  )
  ON CONFLICT (line_login_channel_id) DO UPDATE
  SET branch_id = EXCLUDED.branch_id,
      line_messaging_channel_id = EXCLUDED.line_messaging_channel_id,
      channel_name = EXCLUDED.channel_name,
      webhook_secret_vault_id = EXCLUDED.webhook_secret_vault_id,
      channel_access_token_vault_id = EXCLUDED.channel_access_token_vault_id,
      use_legacy_env_credentials = FALSE,
      is_active = TRUE,
      updated_at = now();

  INSERT INTO public.line_liff_apps (
    liff_id, line_login_channel_id, app_name, is_default, is_active
  )
  VALUES (
    v_liff_id, v_line_login_channel_id,
    v_channel_name || ' - Customer Order', TRUE, TRUE
  )
  ON CONFLICT (liff_id) DO UPDATE
  SET line_login_channel_id = EXCLUDED.line_login_channel_id,
      app_name = EXCLUDED.app_name,
      is_default = TRUE,
      is_active = TRUE;
END;
$setup$;

-- Verify the new mapping without exposing the Vault secrets.
SELECT
  b.branch_code,
  b.branch_name,
  c.line_login_channel_id,
  c.line_messaging_channel_id,
  c.is_active AS channel_active,
  a.liff_id,
  a.is_active AS liff_active,
  (c.webhook_secret_vault_id IS NOT NULL) AS webhook_secret_saved_in_vault,
  (c.channel_access_token_vault_id IS NOT NULL) AS access_token_saved_in_vault
FROM public.line_channels AS c
JOIN public.branches AS b ON b.id = c.branch_id
LEFT JOIN public.line_liff_apps AS a
  ON a.line_login_channel_id = c.line_login_channel_id
WHERE b.branch_code = 'REPLACE_WITH_BRANCH_CODE';
