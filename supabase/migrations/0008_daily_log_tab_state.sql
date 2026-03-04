-- 0008_daily_log_tab_state.sql

create table if not exists public.daily_log_tab_state (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  tab_code text not null, -- 'MAIN','AHUS','BILGES','TANKS','ORB','RUNNING_LOG'
  viewed_at timestamptz null,
  ok_at timestamptz null,
  ok_by uuid null, -- later: references auth.users or profiles
  unique (daily_log_id, tab_code)
);

alter table public.daily_log_tab_state enable row level security;

-- Minimal RLS for now (match your existing pattern: authenticated can read/write)
-- If your project uses service role only server-side, this can be permissive.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='daily_log_tab_state'
  ) then
    create policy "read daily_log_tab_state"
      on public.daily_log_tab_state
      for select
      to authenticated
      using (true);

    create policy "write daily_log_tab_state"
      on public.daily_log_tab_state
      for insert
      to authenticated
      with check (true);

    create policy "update daily_log_tab_state"
      on public.daily_log_tab_state
      for update
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;