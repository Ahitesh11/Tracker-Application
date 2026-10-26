import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
export interface Column<T> { key: string; title: string; render: (row: T) => ReactNode; /** Provide a value to make the column sortable. */ sort?: (row: T) => string | number; }
export function DataTable<T>({ columns, rows, rowKey, emptyMessage = 'No records to display.' }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; emptyMessage?: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const column = columns.find(c => c.key === sort?.key);
    if (!sort || !column?.sort) return rows;
    const value = column.sort;
    return [...rows].sort((a, b) => { const x = value(a), y = value(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir; });
  }, [rows, columns, sort]);
  const toggle = (key: string) => setSort(current => current?.key !== key ? { key, dir: 1 } : current.dir === 1 ? { key, dir: -1 } : null);
  return <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map(column => {
    const active = sort?.key === column.key;
    return <th key={column.key} scope="col" aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>{column.sort ? <button type="button" onClick={() => toggle(column.key)}>{column.title}{active ? (sort!.dir === 1 ? <ArrowUp size={12}/> : <ArrowDown size={12}/>) : <ChevronsUpDown size={12} opacity={.5}/>}</button> : column.title}</th>;
  })}</tr></thead><tbody>{sorted.length ? sorted.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key}>{column.render(row)}</td>)}</tr>) : <tr><td className="empty" colSpan={columns.length}>{emptyMessage}</td></tr>}</tbody></table></div>;
}
