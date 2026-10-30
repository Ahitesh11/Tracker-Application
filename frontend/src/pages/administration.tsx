import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { navigation } from '@/config/navigation';
import { Field } from '@/components/operations-ui';
import { Button } from '@/components/ui/button';
import { request } from '@/services/workspace-api';
import { useI18n } from '@/lib/i18n';
const permissionLabels: Record<string, string> = {
  'users.manage': 'Manage permissions', 'product.edit': 'Edit details', 'product.create': 'Create product line',
  'production.authorize': 'Authorize production', 'production.instruct': 'Record instruction', 'production.ack': 'Record acknowledgment',
  'production.start': 'Start production', 'production.complete': 'Complete production', 'callout': 'Record vendor call-out',
  'followup': 'Update follow-up', 'delivery.revise': 'Revise delivery date', 'draft.review': 'Approval Inbox',
  'shipment.manage': 'Shipments', 'exception.raise': 'Raise a new exception', 'exception.update': 'Exceptions',
  'exception.resolve': 'Exceptions', 'exception.reopen': 'Exceptions', 'product.close': 'Close product line',
  'product.reopen': 'Reopen product line', 'leadtimes.edit': 'Save lead times', 'ai.use': 'AI Assistant'
};
interface User { id: string; display_name: string; role: string; active: boolean; username?: string; pages: string[] | null }
interface Role { id: string; label: string; permissions: string[] }
export function Administration() {
  const { enabled, can } = useAuth(), { t } = useI18n();
  const allowed = enabled && can('users.manage');
  const [users, setUsers] = useState<User[]>([]), [roles, setRoles] = useState<Role[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [saved, setSaved] = useState('');
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    request<{ users: User[]; roles: Role[] }>('/auth/users').then(data => { if (alive) { setUsers(data.users); setRoles(data.roles); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [allowed]);
  async function reload() {
    const data = await request<{ users: User[]; roles: Role[] }>('/auth/users'); setUsers(data.users); setRoles(data.roles);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy('create'); setError(''); setSaved('');
    const values = Object.fromEntries(new FormData(form));
    try { await request('/auth/users', { ...values, pages: createPages }); await reload(); form.reset(); setCreatePages(['/']); setSaved(t('User created.')); }
    catch (error) { setError(error instanceof Error ? error.message : t('Unable to save.')); }
    finally { setBusy(''); }
  }
  const [createPages, setCreatePages] = useState<string[] | null>(['/']);
  const pageChoices = (pages: string[] | null, change: (pages: string[] | null) => void) => <fieldset className="admin-page-picker"><legend>{t('Allowed pages')}</legend><label className="check-field"><input type="checkbox" checked={pages === null} onChange={e => change(e.target.checked ? null : ['/'])}/>{t('All pages')}</label><div>{navigation.map(page => <label className="check-field" key={page.path}><input type="checkbox" disabled={pages === null} checked={pages === null || pages.includes(page.path)} onChange={e => change(e.target.checked ? [...(pages || []), page.path] : (pages || []).filter(p => p !== page.path))}/>{t(page.label)}</label>)}</div></fieldset>;
  const edit = (id: string, patch: Partial<User>) => setUsers(list => list.map(u => u.id === id ? { ...u, ...patch } : u));
  async function save(user: User) {
    setBusy(user.id); setError(''); setSaved('');
    try { await request('/auth/users/' + user.id, { display_name: user.display_name, role: user.role, active: user.active, pages: user.pages }); setSaved(t('Permissions saved.')); window.dispatchEvent(new Event('auth-expired')); }
    catch (e) { setError(e instanceof Error ? e.message : t('Unable to save.')); }
    finally { setBusy(''); }
  }
  if (!allowed) return <div className="info-banner">{t('Only Management can manage permissions.')}</div>;
  return <section className="panel"><div className="settings-body">
    <h2>{t('Manage permissions')}</h2><p className="muted">{t('Assign roles and enable or disable workspace access.')}</p>
    {error && <div className="error-banner" role="alert">{t(error)}</div>}{saved && <div className="success-banner" role="status">{saved}</div>}
    <form className="op-form admin-create" onSubmit={create}>
      <h3>{t('Create user')}</h3><div className="form-grid">
      <Field label={t('Username')}><input name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoComplete="off"/></Field>
      <Field label={t('Password')}><input name="password" type="password" required minLength={8} maxLength={200} autoComplete="new-password"/></Field>
      <Field label={t('Name')}><input name="display_name" required maxLength={100}/></Field>
      <Field label={t('Role')}><select name="role" defaultValue="india">{roles.map(role => <option key={role.id} value={role.id}>{t(role.label)}</option>)}</select></Field></div>
      {pageChoices(createPages, setCreatePages)}
      <p className="muted">{t('Selected pages control navigation. The role controls allowed actions.')}</p>
      <Button type="submit" disabled={Boolean(busy) || loading || createPages?.length === 0}>{t('Create user')}</Button>
    </form>
    {loading ? <p role="status">{t('Loading your workspace')}</p> : users.length === 0 ? <p>{t('No users found.')}</p> : <div className="admin-user-list">{users.map(user => <form className="admin-user-row" key={user.id} onSubmit={e => { e.preventDefault(); void save(user); }}>
      <div className="admin-user-heading"><strong>{user.username || user.display_name}</strong></div><Field label={t('Name')}><input required maxLength={100} value={user.display_name} onChange={e => edit(user.id, { display_name: e.target.value })}/></Field>
      <Field label={t('Role')}><select value={user.role} onChange={e => edit(user.id, { role: e.target.value })}>{roles.map(role => <option key={role.id} value={role.id}>{t(role.label)}</option>)}</select></Field>
      <Field label={t('Access')}><select value={user.active ? 'active' : 'inactive'} onChange={e => edit(user.id, { active: e.target.value === 'active' })}><option value="active">{t('Active')}</option><option value="inactive">{t('Inactive')}</option></select></Field>
      {pageChoices(user.pages, pages => edit(user.id, { pages }))}
      <Button type="submit" disabled={Boolean(busy) || user.pages?.length === 0}>{busy === user.id ? t('Saving…') : t('Save permissions')}</Button>
    </form>)}</div>}
    <h3>{t('Role permissions')}</h3><div className="admin-role-grid">{roles.map(role => <article key={role.id}><strong>{t(role.label)}</strong><ul>{[...new Set(role.permissions.map(permission => permissionLabels[permission] || permission.replace('movement.', '')))].map(label => <li key={label}>{t(label)}</li>)}</ul></article>)}</div>
  </div></section>;
}
