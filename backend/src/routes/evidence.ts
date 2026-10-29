import { Router } from 'express';
import { uploadPhoto, signedUrl, evidenceConfigured } from '../evidence.js';
import { requirePermission } from '../auth.js';
import { must } from '../operations.js';
export const evidenceRouter = Router();

evidenceRouter.get('/status', (_req, res) => res.json({ configured: evidenceConfigured() }));
// One photo per request (the screen shrinks each photo first), so every request stays under the serverless body limit.
evidenceRouter.post('/', async (req, res) => {
  const kind = req.body.kind;
  must(kind === 'loading' || kind === 'receiving', 'Choose loading or receiving photos.');
  requirePermission(req, kind === 'loading' ? 'movement.Container loading' : 'movement.India receiving');
  res.status(201).json({ path: await uploadPhoto(kind, req.body.image) });
});
evidenceRouter.get('/url', async (req, res) => res.json({ url: await signedUrl(String(req.query.path || '')) }));
