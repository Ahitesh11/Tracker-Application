import { app } from './app.js'; import { env } from './config/env.js'; import { closeDatabase } from './operations.js';
const server = app.listen(env.port, env.host, () => console.log('FMS API ready at http://' + env.host + ':' + env.port + ' · Supabase storage · API docs: /api/docs'));
server.keepAliveTimeout=5000;server.headersTimeout=10000;server.requestTimeout=30000;
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
let stopping=false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if(stopping)return;stopping=true;
  server.close(()=>{closeDatabase();});
  const timer=setTimeout(()=>server.closeAllConnections(),10000);timer.unref();
});
