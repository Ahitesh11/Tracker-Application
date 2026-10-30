-- Run after schema.sql. Passwords are managed by Supabase Auth, never this table.
create table if not exists public.tracker_users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  role text not null check (role in ('india', 'china', 'warehouse', 'management')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tracker_users enable row level security;
revoke all on public.tracker_users from anon, authenticated;
grant select on public.tracker_users to authenticated;
grant all on public.tracker_users to service_role;
drop policy if exists tracker_users_read_self on public.tracker_users;
create policy tracker_users_read_self on public.tracker_users
  for select to authenticated using ((select auth.uid()) = id);

comment on table public.tracker_users is 'Workspace privileges. Only administrators assign roles through SQL or service role.';
comment on column public.tracker_users.id is 'User ID from Authentication > Users';
comment on column public.tracker_users.display_name is 'Name recorded in audit history';
comment on column public.tracker_users.role is 'india / china / warehouse / management';
comment on column public.tracker_users.active is 'Set false to immediately block workspace access';

-- 1. Authentication > Users > Add user: create an internal account such as ravi@users.tracker.internal and a password.
-- Operators enter only ravi on the login screen. No real email or Gmail is needed.
-- Use a lowercase username of 3-40 letters/numbers/dots/underscores/hyphens.
-- 2. Replace the example values below, then run separately for each account:
-- insert into public.tracker_users (id, display_name, role)
-- select id, 'Your Name', 'management' from auth.users where email = 'ravi@users.tracker.internal'
-- on conflict (id) do update set display_name = excluded.display_name,
--   role = excluded.role, active = true;

-- Verify headings and assigned users (SQL Editor only):
select p.id as user_id, split_part(u.email, '@', 1) as username, p.display_name, p.role, p.active, p.created_at
from public.tracker_users p join auth.users u on u.id = p.id
order by p.display_name;
