-- Run this in Supabase SQL Editor
-- Deletes unconfirmed users older than 24 hours

-- 1. Create cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_unconfirmed_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users
  WHERE email_confirmed_at IS NULL
    AND created_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- 2. Create a cron job to run every hour (requires pg_cron extension)
-- Enable pg_cron first: Go to Database → Extensions → search "pg_cron" → Enable
SELECT cron.schedule(
  'cleanup-unconfirmed-users',
  '0 * * * *',  -- every hour
  $$SELECT public.cleanup_unconfirmed_users()$$
);
