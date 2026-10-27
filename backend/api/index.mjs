// Vercel serverless entry for the Express API (deploy with Root Directory = backend).
// Data is stored in Supabase, so the function itself keeps no state.
const { app } = await import('../dist/app.js');
export default app;
