-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This creates a secure function to check if an email is registered

CREATE OR REPLACE FUNCTION public.check_email_exists(email_input TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users WHERE email = email_input
  );
END;
$$;

-- Allow anonymous users to call this function
GRANT EXECUTE ON FUNCTION public.check_email_exists(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_email_exists(TEXT) TO authenticated;
