-- SCPA HR Management — Authentication fix for GitHub Pages / Vercel
-- Applied after 0001_initial_schema.sql by the Supabase CLI.
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
