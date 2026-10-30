# Supabase login setup

1. Run schema.sql for the workspace tables, then users.sql for user privileges, and storage.sql for photos in the Supabase SQL Editor.
2. In Authentication > Users > Add user, create an internal account such as ravi@users.tracker.internal with a password (auto-confirm it). No real email account or Gmail is needed. Use lowercase usernames of 3-40 letters/numbers/dots/underscores/hyphens. Passwords belong in Supabase Auth, never tracker_users.
3. Run the commented INSERT example in users.sql with the internal account identifier, display name and role. Assign your first account management. Repeat for india, china and warehouse users.
4. On the backend set AUTH_PROVIDER=supabase, SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_RPC_SECRET. Set SUPABASE_SERVICE_ROLE_KEY for photo storage. Redeploy/restart.
5. Open /login and sign in with just the username (for example ravi) and password. Sessions expire with the Supabase access token; sign in again when expired.

tracker_users headings: id, display_name, role, active, created_at. The verification SELECT in users.sql also shows username. Set active=false to disable access. Users can read only their own role and cannot change privileges.

India: product creation/correction, authorization, delivery dates, India receiving/delivery/return, approvals and closing.
China: product correction, instruction/acknowledgment/start/completion/call-out, China receiving/loading and shipments.
Warehouse: movement drafts and shipments.
Management: all operations, reopening and planning settings.

Product details > Edit details corrects vendor/name/specifications/dimensions and attaches product photos. Corrections are audited. PI-embedded pictures are not automatically extracted; attach product photos here. Existing incorrect vendors need review against the original PI.

## Create users with page access

Management can now use Administration > Create user to set a username, password, role and allowed pages. Existing accounts can have their page access edited below the form. No SQL is needed for each new account. Page access is stored in server-managed Supabase Auth app_metadata.tracker_pages; roles and active status remain in tracker_users. Older accounts without a page list keep their existing navigation. Page access controls navigation and limits role actions; it does not create separate product datasets per user.
