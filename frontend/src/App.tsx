import { Routes, Route, Link } from 'react-router-dom';
import { Layout } from '@/components/layout';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { Dashboard, TrackingPage, ActionCentre, Reports, ActivityLog, Guide } from '@/pages/workspace';
import { Approvals } from '@/pages/approvals';
import { Exceptions } from '@/pages/exceptions';
import { Assistant } from '@/pages/assistant';
import { Settings } from '@/pages/settings';
import { Login } from '@/pages/login';
const trackingViews = ['orders', 'pi', 'production', 'callout', 'china-warehouse', 'shipments', 'india-receiving', 'delivery'];
function NotFound() { const { t } = useI18n(); return <section className="panel p-8"><h2>{t('Page not found')}</h2><Link to="/" className="preview-link">{t('Return to overview')}</Link></section>; }
function Screens() {
  return <WorkspaceProvider><Routes><Route path="/login" element={<Login/>}/><Route element={<Layout/>}><Route index element={<Dashboard/>}/>{trackingViews.map(path => <Route key={path} path={'/' + path} element={<TrackingPage key={path} view={path}/>}/>)}<Route path="/fms" element={<ActionCentre/>}/><Route path="/exceptions" element={<Exceptions/>}/><Route path="/approvals" element={<Approvals/>}/><Route path="/ai-assistant" element={<Assistant/>}/><Route path="/reports" element={<Reports/>}/><Route path="/activity" element={<ActivityLog/>}/><Route path="/settings" element={<Settings/>}/><Route path="/guide" element={<Guide/>}/><Route path="*" element={<NotFound/>}/></Route></Routes></WorkspaceProvider>;
}
/** When sign-in is on, nothing from the workspace loads until the user has signed in. */
function Gate() {
  const { loading, enabled, user } = useAuth();
  if (loading) return <div className="loading-state" style={{ padding: 32 }} aria-busy="true"><div className="skeleton" style={{ height: 120 }}/></div>;
  if (enabled && !user) return <Login/>;
  return <Screens/>;
}
export function App() { return <I18nProvider><AuthProvider><Gate/></AuthProvider></I18nProvider>; }
