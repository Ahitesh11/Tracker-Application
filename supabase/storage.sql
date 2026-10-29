-- Private bucket for container-loading and India-receiving photos.
-- Run once in Supabase -> SQL Editor. (The backend also creates this bucket by itself on the first upload
-- when SUPABASE_SERVICE_ROLE_KEY is set, so running this file is optional.)
--
-- The bucket is PRIVATE and has no storage policies, so the public/anon key can neither list nor read it.
-- Only the backend (service-role key) uploads photos and creates short-lived signed links for signed-in users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shipment-evidence', 'shipment-evidence', false, 5000000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
