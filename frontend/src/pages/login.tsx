import { useState, type FormEvent } from 'react';
import { Armchair, ArrowRight, LogIn, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/components/auth-provider';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
export function Login() {
  const { enabled, login } = useAuth(), { t } = useI18n(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await login(String(form.get('username') || ''), String(form.get('password') || '')); } catch (e) { setError(e instanceof Error ? e.message : t('Could not sign in.')); } finally { setBusy(false); }
  }
  return <main className="login login-compact">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-card-header"><div className="brand"><Armchair size={24}/><span>Tracker<span className="brand-dot">.</span></span></div><LanguageSwitch/></div>
      <h2 id="login-title">{enabled ? t('Sign in') : t('Welcome to your workspace')}</h2>
      {enabled ? <form className="op-form" onSubmit={submit}><label className="op-field"><span>{t('Username')}</span><input name="username" type="text" autoComplete="username" required autoFocus maxLength={100}/></label><label className="op-field"><span>{t('Password')}</span><input name="password" type="password" autoComplete="current-password" required maxLength={200}/></label>{error && <div className="error-banner" role="alert">{t(error)}</div>}<Button type="submit" disabled={busy}><LogIn size={16}/>{busy ? t('Signing in…') : t('Sign in')}</Button><p className="login-note"><ShieldCheck size={18}/> {t('Your role decides what you can change. Every action is recorded under your name.')}</p></form>
        : <><p className="muted">{t('Sign-in is not turned on yet. Set APP_USERS on the backend to give each team member a role.')}</p><Link className="preview-link" to="/">{t('Open your workspace')} <ArrowRight size={16}/></Link></>}
    </section></main>;
}
