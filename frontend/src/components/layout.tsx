import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { Logo } from '@/components/logo';
import { PanelLeftClose, PanelLeftOpen, RefreshCw, ChevronRight, CircleHelp, Search, Menu, CheckCircle2, X, LogOut } from 'lucide-react';
import { navigation } from '@/config/navigation';
/** Pages that stay reachable (product Exceptions tab, search) but are not listed in the sidebar. */
const hiddenFromSidebar = ['/exceptions', '/activity'];
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { ProductDetail } from '@/components/product-detail';
import { CommandPalette } from '@/components/command-palette';
import { useAuth } from '@/components/auth-provider';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import { displayDate } from '@/services/workspace-api';

export function Layout() {
  const [collapsed, setCollapsed] = useState(false), [mobileOpen, setMobileOpen] = useState(false), [palette, setPalette] = useState(false);
  const { data, error, refresh, notice } = useWorkspace(), { enabled, user, logout, can, canPage } = useAuth(), { t } = useI18n();
  const location = useLocation(), current = navigation.find(item => item.path === location.pathname);
  const pending = data?.drafts.filter(d => d.status === 'Pending').length || 0, openExceptions = data?.exceptions.filter(e => e.Status === 'Open').length || 0;
  useEffect(() => { setMobileOpen(false); document.getElementById('main')?.scrollTo({ top: 0 }); }, [location.pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName || '');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(open => !open); }
      else if (event.key === '/' && !typing) { event.preventDefault(); setPalette(true); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);
  return <div className={`app-shell${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
    <a className="skip-link" href="#main">{t('Skip to content')}</a>
    {mobileOpen && <div className="nav-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true"/>}
    <aside className="sidebar">
      <Link to="/" className="brand" aria-label="Forma home"><span className="brand-mark"><Logo size={40}/></span><span>Tracker<span className="brand-dot">.</span><small></small></span></Link>
      <div className="workspace-label">{collapsed ? 'FMS' : t('WORKSPACE')}</div>
      <nav aria-label={t('Main navigation')}>{navigation.filter(item => !hiddenFromSidebar.includes(item.path) && canPage(item.path) && (item.path !== '/administration' || (enabled && can('users.manage')))).map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} title={t(label)} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><Icon size={18}/><span className="nav-label">{t(label)}</span>{path === '/approvals' && pending > 0 && <span className="nav-count">{pending}</span>}{path === '/exceptions' && openExceptions > 0 && <span className="nav-count">{openExceptions}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom">{collapsed ? <div className="workspace-profile" style={{ justifyContent: 'center' }}><span className="avatar">T</span></div> : <div className="workspace-profile"><span className="avatar">LW</span><div><strong></strong><small>{t('India ↔ China')}</small></div><span className="online-dot" title={t('Backend online')}/></div>}</div>
    </aside>
    <div className="main-shell">
      <header className="header">
        <div className="header-left">
          <Button variant="ghost" size="icon" className="mobile-only" aria-label={mobileOpen ? t('Close menu') : t('Open menu')} onClick={() => setMobileOpen(open => !open)}>{mobileOpen ? <X size={20}/> : <Menu size={20}/>}</Button>
          <Button variant="ghost" size="icon" className="desktop-only" aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</Button>
          <span>{t('Workspace')}</span><ChevronRight size={13}/><strong>{current ? t(current.label) : t('Page not found')}</strong>
        </div>
        <div className="header-right">
          <button className="search-trigger" onClick={() => setPalette(true)} aria-label={t('Search (Ctrl+K)')}><Search size={16}/><span>{t('Search products, pages…')}</span><kbd>Ctrl K</kbd></button>
          <LanguageSwitch/>
          <Link to="/guide" title={t('How it works')} aria-label={t('How it works')}><CircleHelp size={19}/></Link>
          {enabled && user && <div className="user-chip" title={t(user.roleLabel)}><span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><small>{t(user.roleLabel)}</small></div><Button variant="outline" onClick={() => void logout()} aria-label={t('Sign out')}><LogOut size={17}/>{t('Sign out')}</Button></div>}
        </div>
      </header>
      <main id="main" className="content" tabIndex={-1}>
        <div className="page-heading"><div><span className="eyebrow">{t('FURNITURE SOURCING · INDIA & CHINA')}</span><h1>{current ? t(current.label) : t('Page not found')}</h1><p>{current ? t(current.description) : ''}</p></div><div className="page-tools"><span className="date-label">{data ? displayDate(data.today) : ''}</span><Button variant="outline" onClick={() => void refresh()} title={t('Refresh workspace')}><RefreshCw size={14}/>{t('Refresh')}</Button></div></div>
        {error && <div className="error-banner" role="alert">{t('Unable to refresh:')} {t(error)} {t('Start the backend with npm run dev:backend.')}{data ? ' ' + t('Showing the last loaded records.') : ''}</div>}
        {!canPage(location.pathname) ? <Navigate to={navigation.find(item => canPage(item.path))?.path || '/login'} replace/> : data ? <Outlet/> : !error && <div className="loading-state" aria-busy="true" aria-label={t('Loading your workspace')}><div className="metric-grid">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 118 }}/>)}</div><div className="skeleton" style={{ height: 220 }}/><div className="skeleton" style={{ height: 320 }}/></div>}
      </main>
      <footer className="footer"><span>{t('Forma · Product-level tracking')}</span><span>{t('Data stored in Supabase')}</span></footer>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18}/>{t(notice)}</div>}
    <CommandPalette open={palette} onClose={() => setPalette(false)}/>
    <ProductDetail/>
  </div>;
}
