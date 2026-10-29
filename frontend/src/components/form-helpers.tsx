import { useEffect, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { Field } from '@/components/operations-ui';
import { useAuth } from '@/components/auth-provider';
import { useI18n } from '@/lib/i18n';
import { newRequestId, request } from '@/services/workspace-api';

/** A key for the current form submit. Call renew() after a successful save so the next save gets a new key. */
export function useRequestId() { const [id, setId] = useState(newRequestId); return [id, () => setId(newRequestId())] as const; }
/** "Your name" is only asked in open mode. When signed in, the server records the signed-in user. */
export function ActorField() {
  const { enabled, user } = useAuth(), { t } = useI18n();
  if (enabled) return <p className="muted actor-note">{t('Recorded as')} <strong>{user?.name}</strong> · {t(user?.roleLabel || '')}</p>;
  return <Field label={t('Your name')}><input name="actor" required maxLength={100} placeholder={t('Operator / reviewer name')}/></Field>;
}
export function EvidenceField() { const { t } = useI18n(); return <Field label={t('Evidence link (optional)')}><input name="evidence" maxLength={500} placeholder={t('Photo, drive or document link')}/></Field>; }

/** Shrinks a photo to at most 1600 px on its long side as a JPEG, so it uploads fast and stays under the size limit. */
async function shrink(file: File) {
  const bitmap = await createImageBitmap(file), scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 1_400_000) return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
  }
  throw new Error('This photo is too large. Take it again.');
}
/** A photo's private storage path shown as a thumbnail through a short-lived signed link. */
export function PhotoThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const [url, setUrl] = useState(''), { t } = useI18n();
  useEffect(() => { let alive = true; request<{ url: string }>(`/evidence/url?path=${encodeURIComponent(path)}`).then(r => { if (alive) setUrl(r.url); }).catch(() => undefined); return () => { alive = false; }; }, [path]);
  return <span className="photo-thumb">{url ? <a href={url} target="_blank" rel="noreferrer noopener"><img src={url} alt={t('Uploaded photo')}/></a> : <span className="photo-loading"/>}{onRemove && <button type="button" aria-label={t('Remove photo')} onClick={onRemove}><X size={12}/></button>}</span>;
}
export function PhotoList({ paths }: { paths?: string[] }) { return paths?.length ? <div className="photo-row">{paths.map(path => <PhotoThumb key={path} path={path}/>)}</div> : null; }
/** Camera / gallery photos uploaded one by one to the private Supabase bucket; `paths` are sent with the draft. */
export function PhotoField({ kind, paths, setPaths, label, required }: { kind: 'loading' | 'receiving'; paths: string[]; setPaths: (paths: string[]) => void; label: string; required?: boolean }) {
  const { t } = useI18n(), [busy, setBusy] = useState(false), [error, setError] = useState(''), max = 8;
  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError('');
    const added: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, max - paths.length)) {
        if (!file.type.startsWith('image/')) throw new Error('Choose photos only (JPG, PNG or WebP).');
        added.push((await request<{ path: string }>('/evidence', { kind, image: await shrink(file) })).path);
      }
    } catch (e) { setError(e instanceof Error ? e.message : t('Photo upload failed.')); }
    setPaths([...paths, ...added]); setBusy(false);
  }
  return <div className="op-field photo-field"><span>{t(label)}{required ? ' *' : ''}</span>
    <div className="photo-row">{paths.map(path => <PhotoThumb key={path} path={path} onRemove={() => setPaths(paths.filter(p => p !== path))}/>)}
      {paths.length < max && <label className={'photo-add' + (busy ? ' busy' : '')}><Camera size={18}/><span>{busy ? t('Uploading…') : t('Add photos')}</span><input type="file" accept="image/*" capture="environment" multiple disabled={busy} onChange={e => { void pick(e.target.files); e.target.value = ''; }}/></label>}</div>
    {error && <div className="error-banner" role="alert">{t(error)}</div>}
    <small className="muted">{t('Up to 8 photos. They are stored privately and shown only to signed-in users.')}</small></div>;
}
