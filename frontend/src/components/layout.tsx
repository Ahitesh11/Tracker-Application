import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { Armchair, PanelLeftClose, PanelLeftOpen, RefreshCw, ChevronRight, CircleHelp, Search, Menu, CheckCircle2, X } from 'lucide-react';
import { navigation } from '@/config/navigation';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { ProductDetail } from '@/components/product-detail';
import { CommandPalette } from '@/components/command-palette';
import { displayDate } from '@/services/workspace-api';
import { useSheetStatus } from '@/lib/sheet-status';

function sheetChip(status: ReturnType<typeof useSheetStatus>) {
  if (!status) return null;
  if (status.sheets === 'connected') return { tone: '', label: 'Google Sheet synced', title: status.sheetsLastSync ? `Last push ${displayDate(status.sheetsLastSync)}` : 'Connected — every saved record is pushed to the sheet' };
  if (status.sheets === 'error') return { tone: 'error', label: 'Sheet sync issue', title: status.sheetsError || 'Google Sheet could not be updated. Data is safe locally.' };
  return { tone: 'off', label: 'Sheet not connected', title: 'Set GOOGLE_APPS_SCRIPT_WEB_APP_URL in backend/.env' };
}
export function Layout() {
  const [collapsed, setCollapsed] = useState(false), [mobileOpen, setMobileOpen] = useState(false), [palette, setPalette] = useState(false);
  const { data, error, refresh, notice } = useWorkspace(), sheet = sheetChip(useSheetStatus());
  const location = useLocation(), current = navigation.find(item => item.path === location.pathname);
  const pending = data?.drafts.filter(d => d.status === 'Pending').length || 0;
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
    <a className="skip-link" href="#main">Skip to content</a>
    {mobileOpen && <div className="nav-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true"/>}
    <aside className="sidebar">
      <Link to="/" className="brand" aria-label="Forma home"><span className="brand-mark"><Armchair size={22}/></span><span>Tracker<span className="brand-dot">.</span><small></small></span></Link>
      <div className="workspace-label">{collapsed ? 'FMS' : 'WORKSPACE'}</div>
      <nav aria-label="Main navigation">{navigation.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} title={label} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><Icon size={18}/><span className="nav-label">{label}</span>{path === '/approvals' && pending > 0 && <span className="nav-count">{pending}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom">{collapsed ? <div className="workspace-profile" style={{ justifyContent: 'center' }}><span className="avatar">T</span></div> : <div className="workspace-profile"><span className="avatar">LW</span><div><strong></strong><small>India ↔ China</small></div><span className="online-dot" title="Backend online"/></div>}</div>
    </aside>
    <div className="main-shell">
      <header className="header">
        <div className="header-left">
          <Button variant="ghost" size="icon" className="mobile-only" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileOpen(open => !open)}>{mobileOpen ? <X size={20}/> : <Menu size={20}/>}</Button>
          <Button variant="ghost" size="icon" className="desktop-only" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</Button>
          <span>Workspace</span><ChevronRight size={13}/><strong>{current?.label || 'Page not found'}</strong>
        </div>
        <div className="header-right">
          <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search (Ctrl+K)"><Search size={16}/><span>Search products, pages…</span><kbd>Ctrl K</kbd></button>
          {sheet && <span className={`sync-chip ${sheet.tone}`} title={sheet.title}><i/>{sheet.label}</span>}
          <Link to="/guide" title="How it works" aria-label="How it works"><CircleHelp size={19}/></Link>
        </div>
      </header>
      <main id="main" className="content" tabIndex={-1}>
        <div className="page-heading"><div><span className="eyebrow">FURNITURE SOURCING · INDIA & CHINA</span><h1>{current?.label || 'Page not found'}</h1><p>{current?.description}</p></div><div className="page-tools"><span className="date-label">{data ? displayDate(data.today) : ''}</span><Button variant="outline" onClick={() => void refresh()} title="Refresh workspace"><RefreshCw size={14}/>Refresh</Button></div></div>
        {error && <div className="error-banner" role="alert">Unable to refresh: {error} Start the backend with npm run dev:backend.{data ? ' Showing the last loaded records.' : ''}</div>}
        {data ? <Outlet/> : !error && <div className="loading-state" aria-busy="true" aria-label="Loading your workspace"><div className="metric-grid">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 118 }}/>)}</div><div className="skeleton" style={{ height: 220 }}/><div className="skeleton" style={{ height: 320 }}/></div>}
      </main>
      <footer className="footer"><span>Forma · Product-level tracking</span><span>Data saved locally{sheet?.tone === '' ? ' · mirrored to Google Sheets' : ''}</span></footer>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18}/>{notice}</div>}
    <CommandPalette open={palette} onClose={() => setPalette(false)}/>
    <ProductDetail/>
  </div>;
}
