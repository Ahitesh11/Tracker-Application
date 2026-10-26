// Vercel serverless entry for the Express API (deploy with Root Directory = backend).
// Vercel's filesystem is read-only except /tmp, and /tmp is wiped on cold starts and not shared between
// instances, so data stored here is temporary. Use a persistent host/database for real data.
process.env.FMS_DB_FILE ??= '/tmp/forma.sqlite';
process.env.FMS_STATE_FILE ??= '/tmp/workspace.json';
const { app } = await import('../dist/app.js');
export default app;
