-- Phase 12: per-user UI preferences such as saved employee table columns.
create table if not exists public.hr_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.hr_user_preferences enable row level security;

drop policy if exists "Users can read their HR preferences" on public.hr_user_preferences;
create policy "Users can read their HR preferences" on public.hr_user_preferences for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can create their HR preferences" on public.hr_user_preferences;
create policy "Users can create their HR preferences" on public.hr_user_preferences for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update their HR preferences" on public.hr_user_preferences;
create policy "Users can update their HR preferences" on public.hr_user_preferences for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their HR preferences" on public.hr_user_preferences;
create policy "Users can delete their HR preferences" on public.hr_user_preferences for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.hr_user_preferences to authenticated;
