-- Tracker: remove test / demo / unwanted data from Supabase.
-- Run in the Supabase SQL Editor. Every DELETE below is commented out on purpose:
-- 1) run the PREVIEW section, 2) remove the leading "-- " from the block you really want, 3) run it.
-- Deleted rows cannot be restored (take Download backup in the app first: Connections & Planning).
-- The app reads fresh data on every request, so no restart is needed; refresh the browser afterwards.

-- ============================================================================
-- PREVIEW: what exists now (safe, read-only)
-- ============================================================================
select p.customer, p.pi, count(*) as product_lines, sum(p.delivered) as delivered_units,
       (select count(*) from tracker_activity a where a.product_id = any(array_agg(p.id))) as activity_rows
from tracker_products p group by p.customer, p.pi order by product_lines desc;

select id as shipment, payload->>'Status' as status, payload->>'Carrier' as carrier,
       jsonb_array_length(coalesce((payload->>'Loading_Lists')::jsonb, '[]'::jsonb)) as loading_lists
from tracker_shipments order by position;

select status, count(*) from tracker_drafts group by status;

-- ============================================================================
-- A) Delete whole PIs with everything linked to them (products, drafts, activity, exceptions)
--    Edit the PI list. Example: the ALOK test entry ('alok11') or the demo PIs.
-- ============================================================================
-- begin;
-- create temp table doomed on commit drop as
--   select id from tracker_products where pi in ('alok11', 'DEMO-PI-001', 'DEMO-PI-002');   -- <- your PI numbers
-- delete from tracker_exceptions where payload->>'Product_ID' in (select id from doomed);
-- delete from tracker_drafts     where product_id in (select id from doomed);
-- delete from tracker_activity   where product_id in (select id from doomed);
-- delete from tracker_products   where id in (select id from doomed);
-- commit;

-- ============================================================================
-- B) Delete shipments (their loading lists are stored inside the shipment, so they go with it)
-- ============================================================================
-- delete from tracker_shipments where id in ('TEST-SHP-ALOK11', 'DEMO-SHP-001', 'SHP-DEMO-001', 'ww', 'testing');

-- ============================================================================
-- C) Remove only the "Claude" test / demo audit rows (keeps your real products and their quantities)
--    Note: quantities that these test movements added to products are NOT undone; use A) for a clean slate.
-- ============================================================================
-- delete from tracker_activity where payload->>'actor' in ('Claude (test entry)', 'Claude demo');

-- ============================================================================
-- D) Delete drafts that are still waiting for review (the Approval Inbox "Pending" list)
-- ============================================================================
-- delete from tracker_drafts where status = 'Pending';

-- ============================================================================
-- E) Start completely empty (products, drafts, activity, shipments, exceptions). Lead times and users stay.
-- ============================================================================
-- begin;
-- delete from tracker_exceptions; delete from tracker_drafts; delete from tracker_activity;
-- delete from tracker_shipments;  delete from tracker_products;
-- commit;

-- Photos uploaded for deleted products stay in the private storage bucket "shipment-evidence" (harmless; delete them in Storage if you want).
