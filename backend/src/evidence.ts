import { randomUUID } from 'node:crypto';
import { HttpError } from './http.js';

/** Private Supabase Storage bucket for loading and receiving photos. The browser never gets a key: it uploads through the API and views through short-lived signed links. */
export const evidenceBucket = 'shipment-evidence';
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const base = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
export const evidenceConfigured = () => Boolean(base() && key());
export const evidencePathPattern = /^[\w-]{1,60}\/[\w-]{1,80}\.(jpg|png|webp)$/;
const extensions: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
export const maxPhotoBytes = 1_500_000;

async function storage(path: string, init: RequestInit = {}) {
  const k = key();
  if (!k) throw new HttpError(503, 'Photo storage is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the backend.');
  try {
    return await fetch(`${base()}/storage/v1${path}`, { ...init, headers: { apikey: k, Authorization: `Bearer ${k}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(25000) });
  } catch { throw new HttpError(502, 'Supabase Storage is unreachable.'); }
}
let bucketReady = false;
/** Creates the private bucket on first use (supabase/storage.sql does the same by hand). */
async function ensureBucket() {
  if (bucketReady) return;
  const found = await storage(`/bucket/${evidenceBucket}`);
  if (found.status === 404 || found.status === 400) {
    const created = await storage('/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: evidenceBucket, name: evidenceBucket, public: false, file_size_limit: 5_000_000, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }) });
    if (!created.ok && created.status !== 409) throw new HttpError(502, 'Could not create the photo bucket in Supabase Storage. Check SUPABASE_SERVICE_ROLE_KEY.');
  } else if (!found.ok) throw new HttpError(502, 'Supabase Storage rejected SUPABASE_SERVICE_ROLE_KEY.');
  bucketReady = true;
}
/** Stores one data-URL image under <folder>/<random>.<ext> and returns the object path. */
export async function uploadPhoto(folder: string, dataUrl: unknown) {
  const match = typeof dataUrl === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!match) throw new HttpError(400, 'Send a JPG, PNG or WebP photo.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 200 || bytes.length > maxPhotoBytes) throw new HttpError(400, 'Each photo must be under 1.5 MB. Take it again or use a smaller size.');
  await ensureBucket();
  const path = `${folder}/${randomUUID()}.${extensions[match[1]]}`;
  const response = await storage(`/object/${evidenceBucket}/${path}`, { method: 'POST', headers: { 'Content-Type': `image/${match[1]}`, 'x-upsert': 'false' }, body: bytes });
  if (!response.ok) throw new HttpError(502, 'The photo could not be saved to Supabase Storage.');
  return path;
}
/** A signed link that works for 10 minutes. */
export async function signedUrl(path: string, seconds = 600) {
  if (!evidencePathPattern.test(path)) throw new HttpError(400, 'Invalid photo path.');
  const response = await storage(`/object/sign/${evidenceBucket}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }) });
  if (!response.ok) throw new HttpError(404, 'Photo not found.');
  const data = await response.json() as { signedURL?: string };
  if (!data.signedURL) throw new HttpError(404, 'Photo not found.');
  return `${base()}/storage/v1${data.signedURL}`;
}
/** The photo as a data URL, for the AI model (signed links may not be reachable from every provider). */
export async function photoDataUrl(path: string) {
  const response = await storage(`/object/${evidenceBucket}/${path}`);
  if (!response.ok) return null;
  const type = response.headers.get('content-type') || 'image/jpeg';
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}
