import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import zh from '@/i18n/zh.json';
import { patterns } from '@/i18n/patterns';

export type Lang = 'en' | 'zh';
export const languages: { code: Lang; label: string; name: string }[] = [{ code: 'en', label: 'EN', name: 'English' }, { code: 'zh', label: '中文', name: '简体中文' }];
const key = 'tracker-lang';
function initial(): Lang {
  try { const saved = localStorage.getItem(key); if (saved === 'en' || saved === 'zh') return saved; } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
let current: Lang = initial();
export const getLang = () => current;
const dictionary = zh as Record<string, string>;
const fill = (text: string, vars?: Record<string, string | number>) => vars ? text.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole) : text;

/**
 * Translate a UI string. The English text is the key, so a missing translation simply shows English.
 * Also used for text that comes from the backend (statuses, alerts, error messages): exact matches first,
 * then patterns for sentences that contain numbers or names.
 */
export function tx(text: string, vars?: Record<string, string | number>): string {
  if (current === 'en' || !text) return fill(text, vars);
  const exact = dictionary[text];
  if (exact) return fill(exact, vars);
  for (const [pattern, build] of patterns) { const match = text.match(pattern); if (match) return build(match, tx); }
  return fill(text, vars);
}
export const dateLocale = () => current === 'zh' ? 'zh-CN' : 'en-GB';

interface I18n { lang: Lang; setLang: (lang: Lang) => void; t: typeof tx }
const Context = createContext<I18n>({ lang: 'en', setLang: () => {}, t: tx });
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);
  const setLang = (next: Lang) => { current = next; try { localStorage.setItem(key, next); } catch { /* ignore */ } setState(next); };
  return <Context.Provider value={{ lang, setLang, t: tx }}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);

/** Small EN | 中文 switch used in the header and on the sign-in page. */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return <div className={`lang-switch ${className}`} role="group" aria-label="Language / 语言">{languages.map(item => <button key={item.code} type="button" aria-pressed={lang === item.code} title={item.name} onClick={() => setLang(item.code)}>{item.label}</button>)}</div>;
}
