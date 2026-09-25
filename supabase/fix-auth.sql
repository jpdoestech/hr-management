-- SCPA HR Management — Authentication fix for GitHub Pages / Vercel
-- Run this AFTER supabase/schema.sql in the Supabase SQL Editor.
-- This fixes username login without exposing the profiles table to anonymous users.

create or replace function public.get_login_email_by_username(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email
  from public.profiles
  where lower(username) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.get_login_email_by_username(text) from public;
grant execute on function public.get_login_email_by_username(text) to anon, authenticated;
