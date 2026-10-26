-- Forma / Tracker storage for Supabase (Postgres).
-- Run this whole file once in Supabase -> SQL Editor.
--
-- Security model: the browser never talks to Supabase. Only the backend does, through the functions below,
-- and every function requires a shared secret that is stored in tracker_private. Tables have row level
-- security enabled with NO policies, so the public API cannot read or write them directly.
--
-- IMPORTANT: replace CHANGE-ME-SECRET (last statement) with your own long random text, and put the same
-- value in the backend environment variable SUPABASE_RPC_SECRET. Never commit the real value.

create table if not exists tracker_private (id int primary key default 1 check (id = 1), secret text not null);
create table if not exists tracker_meta (
  id int primary key check (id = 1), revision int not null, payload jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists tracker_products (
  id text primary key, pi text not null, customer text not null, vendor text not null,
  quantity int not null check (quantity > 0),
  china int not null check (china >= 0 and china <= quantity),
  loaded int not null check (loaded >= 0 and loaded <= china),
  india int not null check (india >= 0 and india <= loaded),
  delivered int not null check (delivered >= 0 and delivered <= india),
  payload jsonb not null, position int not null
);
create index if not exists tracker_products_pi on tracker_products(pi);
create index if not exists tracker_products_customer on tracker_products(customer);
create table if not exists tracker_lead_times (
  category text not null, subcategory text not null, payload jsonb not null, position int not null,
  primary key (category, subcategory)
);
create table if not exists tracker_drafts (
  id text primary key, product_id text not null, matched_product_id text references tracker_products(id),
  status text not null check (status in ('Pending', 'Approved', 'Rejected')), payload jsonb not null, position int not null
);
create index if not exists tracker_drafts_status on tracker_drafts(status);
create table if not exists tracker_activity (
  id text primary key, product_id text not null, action text not null, document text not null, at text not null,
  payload jsonb not null, position int not null
);
create index if not exists tracker_activity_product on tracker_activity(product_id, at);
create table if not exists tracker_shipments (id text primary key, payload jsonb not null, position int not null);
create table if not exists tracker_exceptions (id text primary key, payload jsonb not null, position int not null);

alter table tracker_private enable row level security;
alter table tracker_meta enable row level security;
alter table tracker_products enable row level security;
alter table tracker_lead_times enable row level security;
alter table tracker_drafts enable row level security;
alter table tracker_activity enable row level security;
alter table tracker_shipments enable row level security;
alter table tracker_exceptions enable row level security;
revoke all on tracker_private, tracker_meta, tracker_products, tracker_lead_times, tracker_drafts, tracker_activity, tracker_shipments, tracker_exceptions from anon, authenticated;

create or replace function tracker_check(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or not exists (select 1 from tracker_private where secret = p_secret) then
    raise exception 'UNAUTHORIZED: invalid backend secret' using errcode = '28000';
  end if;
end $$;

-- Returns the whole workspace, or null when it has not been initialised yet.
create or replace function tracker_read(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare meta tracker_meta;
begin
  perform tracker_check(p_secret);
  select * into meta from tracker_meta where id = 1;
  if not found then return null; end if;
  return meta.payload || jsonb_build_object(
    'revision', meta.revision,
    'products', coalesce((select jsonb_agg(payload order by position) from tracker_products), '[]'::jsonb),
    'leads', coalesce((select jsonb_agg(payload order by position) from tracker_lead_times), '[]'::jsonb),
    'drafts', coalesce((select jsonb_agg(payload order by position) from tracker_drafts), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(payload order by position) from tracker_activity), '[]'::jsonb),
    'shipments', coalesce((select jsonb_agg(payload order by position) from tracker_shipments), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(payload order by position) from tracker_exceptions), '[]'::jsonb));
end $$;

-- Atomically stores the workspace. p_expected_revision is 0 for the very first save, otherwise the revision
-- the caller loaded. Existing activity (audit) rows cannot change and products cannot be removed.
-- Returns {revision, newActivityIds}.
create or replace function tracker_save(p_secret text, p_state jsonb, p_expected_revision int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare current_revision int; new_revision int; new_ids jsonb;
begin
  perform tracker_check(p_secret);
  if p_state is null or (p_state->>'version') is distinct from '1' or coalesce(p_state->>'source', '') = ''
     or jsonb_typeof(p_state->'products') is distinct from 'array' or jsonb_typeof(p_state->'leads') is distinct from 'array'
     or jsonb_typeof(p_state->'drafts') is distinct from 'array' or jsonb_typeof(p_state->'activity') is distinct from 'array'
     or jsonb_typeof(p_state->'shipments') is distinct from 'array' or jsonb_typeof(p_state->'exceptions') is distinct from 'array' then
    raise exception 'INVALID: unsupported or corrupt workspace data';
  end if;
  if jsonb_array_length(p_state->'leads') = 0 then raise exception 'INVALID: workspace lead times are missing'; end if;

  perform pg_advisory_xact_lock(727001);
  select revision into current_revision from tracker_meta where id = 1;
  if not found then
    if p_expected_revision <> 0 then raise exception 'CONFLICT: Workspace changed since you loaded it. Refresh and try again.'; end if;
    new_revision := 1;
  else
    if current_revision <> p_expected_revision then raise exception 'CONFLICT: Workspace changed since you loaded it. Refresh and try again.'; end if;
    new_revision := current_revision + 1;
  end if;

  if exists (select 1 from tracker_activity a where not exists (
       select 1 from jsonb_array_elements(p_state->'activity') e where e->>'id' = a.id and e = a.payload)) then
    raise exception 'CONFLICT: Existing audit events cannot be changed or removed.';
  end if;
  if exists (select 1 from tracker_products p where not exists (
       select 1 from jsonb_array_elements(p_state->'products') e where e->>'id' = p.id)) then
    raise exception 'CONFLICT: Existing products cannot be silently removed.';
  end if;

  select coalesce(jsonb_agg(e->>'id'), '[]'::jsonb) into new_ids
    from jsonb_array_elements(p_state->'activity') e where not exists (select 1 from tracker_activity a where a.id = e->>'id');

  insert into tracker_products (id, pi, customer, vendor, quantity, china, loaded, india, delivered, payload, position)
  select e->>'id', e->>'pi', e->>'customer', e->>'vendor', (e->>'quantity')::int, (e->>'china')::int, (e->>'loaded')::int,
         (e->>'india')::int, (e->>'delivered')::int, e, (ord - 1)::int
    from jsonb_array_elements(p_state->'products') with ordinality as t(e, ord)
  on conflict (id) do update set pi = excluded.pi, customer = excluded.customer, vendor = excluded.vendor,
    quantity = excluded.quantity, china = excluded.china, loaded = excluded.loaded, india = excluded.india,
    delivered = excluded.delivered, payload = excluded.payload, position = excluded.position;

  insert into tracker_lead_times (category, subcategory, payload, position)
  select e->>'category', e->>'subcategory', e, (ord - 1)::int from jsonb_array_elements(p_state->'leads') with ordinality as t(e, ord)
  on conflict (category, subcategory) do update set payload = excluded.payload, position = excluded.position;

  insert into tracker_drafts (id, product_id, matched_product_id, status, payload, position)
  select e->>'id', e->>'productId',
         (select p.id from tracker_products p where p.id = e->>'productId'), e->>'status', e, (ord - 1)::int
    from jsonb_array_elements(p_state->'drafts') with ordinality as t(e, ord)
  on conflict (id) do update set status = excluded.status, matched_product_id = excluded.matched_product_id,
    payload = excluded.payload, position = excluded.position;

  insert into tracker_activity (id, product_id, action, document, at, payload, position)
  select e->>'id', e->>'productId', e->>'action', e->>'document', e->>'at', e, (ord - 1)::int
    from jsonb_array_elements(p_state->'activity') with ordinality as t(e, ord)
  on conflict (id) do update set position = excluded.position;

  insert into tracker_shipments (id, payload, position)
  select e->>'Shipment_ID', e, (ord - 1)::int from jsonb_array_elements(p_state->'shipments') with ordinality as t(e, ord)
  on conflict (id) do update set payload = excluded.payload, position = excluded.position;

  insert into tracker_exceptions (id, payload, position)
  select e->>'Exception_ID', e, (ord - 1)::int from jsonb_array_elements(p_state->'exceptions') with ordinality as t(e, ord)
  on conflict (id) do update set payload = excluded.payload, position = excluded.position;

  insert into tracker_meta (id, revision, payload, updated_at)
  values (1, new_revision, jsonb_build_object('version', 1, 'source', p_state->>'source', 'importedAt', p_state->>'importedAt'), now())
  on conflict (id) do update set revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at;

  return jsonb_build_object('revision', new_revision, 'newActivityIds', new_ids);
end $$;

-- Lightweight check used by /api/health.
create or replace function tracker_ready(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform tracker_check(p_secret);
  return jsonb_build_object('initialized', exists (select 1 from tracker_meta where id = 1));
end $$;

revoke all on function tracker_check(text), tracker_read(text), tracker_save(text, jsonb, int), tracker_ready(text) from public;
grant execute on function tracker_read(text), tracker_save(text, jsonb, int), tracker_ready(text) to anon, authenticated;
revoke all on function tracker_check(text) from anon, authenticated;

-- Last step: set your backend secret (same value as SUPABASE_RPC_SECRET). Re-run this line to rotate it.
insert into tracker_private (id, secret) values (1, 'CHANGE-ME-SECRET')
on conflict (id) do update set secret = excluded.secret;
