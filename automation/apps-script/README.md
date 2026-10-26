# Apps Script receiver

`GoogleAppsScript.gs` is a small web app. The Forma backend POSTs each new record to it and it writes the row into the Google Sheet (tabs `Activity_Log` and `Products`).

## Setup

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Replace the editor content with `GoogleAppsScript.gs`.
3. Set `var SECRET` at the top of the script to your own long random text (the same value goes in `backend/.env` as `GOOGLE_APPS_SCRIPT_SECRET`). Never commit the real value.
4. **Deploy → New deployment → type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy and copy the **Web app URL** (ends with `/exec`).
5. In `backend/.env` set:
   ```
   GOOGLE_APPS_SCRIPT_WEB_APP_URL=<the /exec URL>
   GOOGLE_APPS_SCRIPT_SECRET=<same text as `var SECRET` in the script>
   ```
6. Restart the backend. Check `GET /api/integrations/status` → `"sheets": "connected"`, then run `POST /api/integrations/sheets/sync` to push existing data.

After changing the script code, use **Deploy → Manage deployments → Edit → New version**; the URL stays the same.

"Anyone" access only means the URL is reachable; every request without the correct secret is rejected. Do not share the URL or the secret.
