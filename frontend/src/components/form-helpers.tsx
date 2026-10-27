import { useState } from 'react';
import { Field } from '@/components/operations-ui';
import { useAuth } from '@/components/auth-provider';
import { newRequestId } from '@/services/workspace-api';

/** A key for the current form submit. Call renew() after a successful save so the next save gets a new key. */
export function useRequestId() { const [id, setId] = useState(newRequestId); return [id, () => setId(newRequestId())] as const; }
/** "Your name" is only asked in open mode. When signed in, the server records the signed-in user. */
export function ActorField() {
  const { enabled, user } = useAuth();
  if (enabled) return <p className="muted actor-note">Recorded as <strong>{user?.name}</strong> · {user?.roleLabel}</p>;
  return <Field label="Your name"><input name="actor" required maxLength={100} placeholder="Operator / reviewer name"/></Field>;
}
export function EvidenceField() { return <Field label="Evidence link (optional)"><input name="evidence" maxLength={500} placeholder="Photo, drive or document link"/></Field>; }
