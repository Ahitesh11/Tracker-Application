import { useEffect, useState } from 'react';
import { request } from '@/services/workspace-api';
export interface SheetStatus { sheets: 'connected' | 'error' | 'disconnected'; sheetsError?: string; sheetsLastSync?: string }
/** Polls the backend so the header can show whether records are reaching the Google Sheet. */
export function useSheetStatus() {
  const [status, setStatus] = useState<SheetStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => request<SheetStatus>('/integrations/status').then(value => { if (live) setStatus(value); }).catch(() => { if (live) setStatus(null); });
    void load(); const timer = setInterval(load, 15000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return status;
}
