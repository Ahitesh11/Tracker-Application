import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Package, RefreshCw, Compass } from 'lucide-react';
import { navigation } from '@/config/navigation';
import { useWorkspace } from '@/components/workspace-provider';

interface Item { id: string; group: string; title: string; hint: string; icon: typeof Search; run: () => void }
/** Ctrl/⌘+K: jump to any page, open any product, or run a quick action. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, select, refresh } = useWorkspace(), navigate = useNavigate();
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQuery(''); setIndex(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase(), match = (text: string) => !q || text.toLowerCase().includes(q);
    const pages = navigation.filter(n => match(n.label + ' ' + n.description)).map<Item>(n => ({ id: n.path, group: 'GO TO', title: n.label, hint: n.description, icon: n.icon, run: () => navigate(n.path) }));
    const products = (data?.products || []).filter(p => q && match([p.name, p.id, p.pi, p.customer, p.vendor, p.order].join(' '))).slice(0, 8).map<Item>(p => ({ id: p.id, group: 'PRODUCTS', title: p.name, hint: `${p.pi} · ${p.customer} · ${p.planning.stage}`, icon: Package, run: () => select(p.id) }));
    const actions: Item[] = [
      { id: 'refresh', group: 'ACTIONS', title: 'Refresh workspace', hint: 'Reload the latest records', icon: RefreshCw, run: () => void refresh() },
    ].filter(a => match(a.title));
    return [...products, ...pages, ...actions];
  }, [query, data, navigate, select, refresh]);
  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);
  if (!open) return null;
  const choose = (item?: Item) => { if (!item) return; onClose(); item.run(); };
  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(items[index]); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }
  let lastGroup = '';
  return <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
      <div className="palette-input"><Search size={18}/><input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products, PI, customer — or jump to a page…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list"/><kbd>Esc</kbd></div>
      <div className="palette-list" id="palette-list" role="listbox" ref={list}>
        {items.length === 0 && <div className="palette-empty"><Compass size={22}/><p>No results for “{query}”.</p></div>}
        {items.map((item, i) => { const header = item.group !== lastGroup; lastGroup = item.group; const Icon = item.icon; return <div key={item.group + item.id}>{header && <div className="palette-group">{item.group}</div>}<button className="palette-item" role="option" aria-selected={i === index} onMouseMove={() => setIndex(i)} onClick={() => choose(item)}><Icon size={18}/><div><strong>{item.title}</strong><small>{item.hint}</small></div>{i === index && <CornerDownLeft size={15}/>}</button></div>; })}
      </div>
      <div className="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
    </div>
  </div>;
}
