create table if not exists public.food_check_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.food_check_state enable row level security;

drop policy if exists "server service role manages food check state" on public.food_check_state;

create policy "server service role manages food check state"
on public.food_check_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
