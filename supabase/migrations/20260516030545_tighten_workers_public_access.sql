alter table public.workers enable row level security;

drop policy if exists "Anyone can read active workers" on public.workers;
drop policy if exists "Anyone can add active workers" on public.workers;
drop policy if exists "Super admins can manage workers" on public.workers;

revoke all on table public.workers from anon;
revoke all on table public.workers from authenticated;
revoke all on table public.workers from service_role;

grant select, insert on table public.workers to anon;
grant select, insert on table public.workers to authenticated;
grant all on table public.workers to service_role;

create policy "Anyone can read active workers"
on public.workers
for select
to anon, authenticated
using (is_active = true);

create policy "Anyone can add active workers"
on public.workers
for insert
to anon, authenticated
with check (
  is_active = true
  and length(btrim(name)) >= 2
  and length(btrim(name)) <= 120
);
