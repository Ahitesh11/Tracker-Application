import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Logo } from '@/components/logo';
import { ArrowRight, Camera, ClipboardCheck, Eye, EyeOff, Factory, Lock, LogIn, Route, ShieldCheck, Sparkles, TriangleAlert, User, Warehouse } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/components/auth-provider';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

const remembered = () => { try { return localStorage.getItem('tracker-username') || ''; } catch { return ''; } };
const remember = (name: string, on: boolean) => { try { if (on) localStorage.setItem('tracker-username', name); else localStorage.removeItem('tracker-username'); } catch { /* private window: nothing to remember */ } };
const highlights = [
  { icon: Route, title: 'Nine-stage product journey', text: 'Every product from measurement to customer delivery, with an owner in India or China at each step.' },
  { icon: Camera, title: 'Proof at every handover', text: 'Production, loading and carton photos are attached to the record.' },
  { icon: Sparkles, title: 'AI-read loading lists', text: 'Upload a container list; a controller approves it before anything moves.' },
  { icon: ClipboardCheck, title: 'Fully traceable', text: 'Every action is saved under the name of the person who did it.' },
];

export function Login() {
  const { enabled, login } = useAuth(), { t } = useI18n(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [saved] = useState(remembered), [show, setShow] = useState(false), [caps, setCaps] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget), username = String(form.get('username') || '');
    try { await login(username, String(form.get('password') || '')); remember(username, form.get('remember') === 'on'); } catch (e) { setError(e instanceof Error ? e.message : t('Could not sign in.')); } finally { setBusy(false); }
  }
  const watchCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'));
  return <main className="login login-v2"><div className="login-shell">
    <aside className="login-story" aria-hidden={!enabled}>
      <div className="brand"><Logo size={38}/><span>Tracker<span className="brand-dot">.</span></span></div>
      <div>
        <span className="eyebrow">{t('FURNITURE SOURCING')}</span>
        <h1>{t('From the factory floor to the customer’s door.')}</h1>
        <p>{t('One place for your China and India teams to track every product, shipment and delivery.')}</p>
        <div className="login-route"><Factory size={18}/>{t('China')}<ArrowRight size={16}/><Warehouse size={18}/>{t('India')}</div>
        <ul className="login-points">{highlights.map(({ icon: Icon, title, text }) => <li key={title} title={t(text)}><Icon size={18}/><strong>{t(title)}</strong></li>)}</ul>
      </div>
      <small>{t('Quantities and dates are recorded by your team, with evidence.')}</small>
    </aside>
    <section className="login-panel"><div className="login-lang"><LanguageSwitch/></div>
      <div className="login-card" aria-labelledby="login-title">
        <div className="brand login-card-brand"><Logo size={32}/><span>Tracker<span className="brand-dot">.</span></span></div>
        <div><h2 id="login-title">{enabled ? t('Welcome back') : t('Welcome to your workspace')}</h2>{enabled && <p className="muted">{t('Sign in to continue to your workspace.')}</p>}</div>
        {enabled ? <form className="op-form" onSubmit={submit}>
          <label className="op-field"><span>{t('Username')}</span><div className="login-input"><User size={17}/><input name="username" type="text" autoComplete="username" required autoFocus={!saved} defaultValue={saved} maxLength={100} placeholder={t('Your username')} autoCapitalize="none" spellCheck={false}/></div></label>
          <label className="op-field"><span>{t('Password')}</span><div className="login-input"><Lock size={17}/><input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required autoFocus={Boolean(saved)} maxLength={200} placeholder={t('Your password')} onKeyUp={watchCaps} onKeyDown={watchCaps} onBlur={() => setCaps(false)}/><button type="button" className="login-eye" onClick={() => setShow(v => !v)} aria-label={show ? t('Hide password') : t('Show password')} aria-pressed={show}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>{caps && <small className="login-caps"><TriangleAlert size={13}/> {t('Caps Lock is on')}</small>}</label>
          <label className="login-remember"><input type="checkbox" name="remember" defaultChecked={Boolean(saved)}/><span>{t('Remember my username on this device')}</span></label>
          {error && <div className="error-banner" role="alert">{t(error)}</div>}
          <Button type="submit" disabled={busy}><LogIn size={16}/>{busy ? t('Signing in…') : t('Sign in')}</Button>
          <p className="login-note"><ShieldCheck size={18}/> {t('Your role decides what you can change. Every action is recorded under your name.')}</p>
          <small className="login-help">{t('Forgot your password? Ask your administrator to reset it.')}</small>
        </form>
          : <><p className="muted">{t('Sign-in is not turned on yet. Set APP_USERS on the backend to give each team member a role.')}</p><Link className="preview-link" to="/">{t('Open your workspace')} <ArrowRight size={16}/></Link></>}
      </div>
    </section>
  </div></main>;
}
