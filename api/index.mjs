// Vercel serverless function: serves the Express API at /api/* from the same project as the frontend.
// All data is stored in Supabase, so the function itself keeps no state.
const { app } = await import('../backend/dist/app.js');
export default app;
