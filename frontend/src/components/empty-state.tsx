import { FolderOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
export function EmptyState({ title, description }: { title: string; description: string }) { const { t } = useI18n(); return <div className="empty-state"><div className="empty-icon"><FolderOpen size={25}/></div><h3>{t(title)}</h3><p>{t(description)}</p></div>; }
