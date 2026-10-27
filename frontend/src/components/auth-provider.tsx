import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { request } from '@/services/workspace-api';
interface Me { enabled: boolean; user: { name: string; role: string; roleLabel: string } | null; permissions: string[] }
interface AuthContext extends Me { loading: boolean; can: (permission: string) => boolean; login: (username: string, password: string) => Promise<void>; logout: () => Promise<void> }
const Context = createContext<AuthContext | null>(null);
/** Knows who is signed in. Without APP_USERS on the backend the app is open and every action is allowed. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>({ enabled: false, user: null, permissions: [] }), [loading, setLoading] = useState(true);
  const load = useCallback(async () => { try { setMe(await request<Me>('/auth/me')); } catch { /* the workspace shows the connection error */ } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); window.addEventListener('auth-expired', load); return () => window.removeEventListener('auth-expired', load); }, [load]);
  const login = async (username: string, password: string) => { await request('/auth/login', { username, password }); await load(); };
  const logout = async () => { await request('/auth/logout', {}); await load(); };
  const can = (permission: string) => !me.enabled || me.permissions.includes(permission);
  return <Context.Provider value={{ ...me, loading, can, login, logout }}>{children}</Context.Provider>;
}
export function useAuth() { const context = useContext(Context); if (!context) throw new Error('Auth provider is missing.'); return context; }
