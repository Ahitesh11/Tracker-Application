import { Routes, Route, Link } from 'react-router-dom';
import { Layout } from '@/components/layout';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { Dashboard, TrackingPage, ActionCentre, Reports, ActivityLog, Guide } from '@/pages/workspace';
import { Approvals } from '@/pages/approvals';
import { Assistant } from '@/pages/assistant';
import { Settings } from '@/pages/settings';
import { Login } from '@/pages/login';
export function App() { return <WorkspaceProvider><Routes><Route path="/login" element={<Login/>}/><Route element={<Layout/>}><Route index element={<Dashboard/>}/>{['orders','pi','production','china-warehouse','shipments','india-receiving','delivery'].map(path => <Route key={path} path={'/'+path} element={<TrackingPage key={path} view={path}/>}/>)}<Route path="/fms" element={<ActionCentre/>}/><Route path="/approvals" element={<Approvals/>}/><Route path="/ai-assistant" element={<Assistant/>}/><Route path="/reports" element={<Reports/>}/><Route path="/activity" element={<ActivityLog/>}/><Route path="/settings" element={<Settings/>}/><Route path="/guide" element={<Guide/>}/><Route path="*" element={<section className="panel p-8"><h2>Page not found</h2><Link to="/" className="preview-link">Return to overview</Link></section>}/></Route></Routes></WorkspaceProvider>; }
