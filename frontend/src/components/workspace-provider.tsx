import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { request, type WorkspaceData } from '@/services/workspace-api';
interface WorkspaceContext { data: WorkspaceData | null; error: string; busy: boolean; refresh: () => Promise<void>; mutate: (path: string, body: unknown) => Promise<WorkspaceData | undefined>; selected: string; select: (id: string) => void; notice: string }
const Context = createContext<WorkspaceContext | null>(null);
export function WorkspaceProvider({ children, initialData = null }: { children: ReactNode; initialData?: WorkspaceData | null }) {
  const [data, setData] = useState<WorkspaceData | null>(initialData), [error, setError] = useState(''), [busy, setBusy] = useState(false), [selected, select] = useState(''), [notice, setNotice] = useState('');
  const refresh = useCallback(async () => { try { setData(await request<WorkspaceData>('/workspace')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Start the backend to load your workspace.'); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  async function mutate(path: string, body: unknown) {
    if (busy) return undefined; // a second click while saving is ignored
    setBusy(true);
    try { const payload = body && typeof body === 'object' ? { ...body, revision: data?.revision } : body; const result = await request<WorkspaceData>(path, payload); setData(result); setError(''); setNotice('Saved. Tracking and planning are up to date.'); return result; }
    finally { setBusy(false); }
  }
  return <Context.Provider value={{ data, error, busy, refresh, mutate, selected, select, notice }}>{children}</Context.Provider>;
}
export function useWorkspace() { const context = useContext(Context); if (!context) throw new Error('Workspace provider is missing.'); return context; }
