-- Revoke direct PostgREST execution of the RLS auto-enable event-trigger function.
-- PostgreSQL event triggers still invoke it through their registered event trigger.

BEGIN;
REVOKE ALL ON FUNCTION public.rls_auto_enable()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable()
TO service_role;
COMMIT;
