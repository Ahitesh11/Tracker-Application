import './config/env.js';
import express from 'express'; import { integrationsRouter } from './routes/integrations.js'; import { workspaceRouter } from './routes/workspace.js'; import { assistantRouter } from './routes/assistant.js';
import { env } from './config/env.js';
import { databaseHealth } from './operations.js';
import { requestContext, jsonBody, errors, HttpError } from './http.js';
import { catalogRouter } from './routes/catalog.js';
import { openapi, docsHtml } from './openapi.js';
export const app = express(); app.disable('x-powered-by'); app.disable('etag');
app.use(requestContext);
app.use('/api', (req,res,next)=>{
  const origin=req.headers.origin;
  if(origin && !env.origins.includes(origin)){next(new HttpError(403,'Origin is not allowed.'));return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.vary('Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
  if(req.method==='OPTIONS'){res.sendStatus(204);return;}next();
});
app.use(express.json({ limit: '100kb' }));app.use('/api',jsonBody);
app.get('/api/health', (_req, res) => {const database=databaseHealth();res.status(database.ready?200:503).json({status:database.ready?'ok':'unavailable',workspace:'product-tracking',storage:'sqlite',database});});
app.get('/api/ready', (_req,res)=>res.json({ready:databaseHealth().ready}));
app.get('/api/openapi.json',(_req,res)=>res.json(openapi));
app.get('/api/docs',(_req,res)=>res.type('html').send(docsHtml));
app.use('/api/integrations', integrationsRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api',catalogRouter);
app.use('/api/assistant', assistantRouter);
app.use((_req,_res,next)=>next(new HttpError(404,'Route not found.')));
app.use(errors);
