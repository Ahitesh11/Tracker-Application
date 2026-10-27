import { useState, type FormEvent } from 'react';
import { Armchair, ArrowRight, LogIn, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
export function Login() {
  const { enabled, login } = useAuth(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await login(String(form.get('username') || ''), String(form.get('password') || '')); } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in.'); } finally { setBusy(false); }
  }
  return <main className="login"><section className="login-story"><div className="brand"><Armchair size={32}/><span>Tracker<span className="brand-dot">.</span></span></div><div><span className="eyebrow">FURNITURE SOURCING OPERATIONS</span><h1>Every product.<br/>One clear journey.</h1><p>Track production, warehouse receipts, shipments and customer deliveries in one workspace.</p><div className="login-route">China <ArrowRight size={18}/> India <ArrowRight size={18}/> Customer</div></div><small>India Controller · China Controller · Warehouse · Management</small></section>
    <section className="login-panel"><div className="login-card"><span className="pill">TRACKER WORKSPACE</span><h2>{enabled ? 'Sign in' : 'Welcome to your workspace'}</h2>
      {enabled ? <form className="op-form" onSubmit={submit}><label className="op-field"><span>Username</span><input name="username" autoComplete="username" required autoFocus maxLength={100}/></label><label className="op-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required maxLength={200}/></label>{error && <div className="error-banner" role="alert">{error}</div>}<Button type="submit" disabled={busy}><LogIn size={16}/>{busy ? 'Signing in…' : 'Sign in'}</Button><p className="login-note"><ShieldCheck size={18}/> Your role decides what you can change. Every action is recorded under your name.</p></form>
        : <><p className="muted">Sign-in is not turned on yet. Set APP_USERS on the backend to give each team member a role.</p><Link className="preview-link" to="/">Open your workspace <ArrowRight size={16}/></Link></>}
    </div></section></main>;
}
