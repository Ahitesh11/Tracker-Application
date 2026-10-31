import { useId } from 'react';

/** The Tracker mark: a sofa with a tracking pin. The same artwork is public/favicon.svg. */
export function Logo({ size = 40 }: { size?: number }) {
  const id = useId();
  return <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Tracker" focusable="false">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#16a34a"/><stop offset="1" stopColor="#2dd4bf"/></linearGradient></defs>
    <rect width="64" height="64" rx="16" fill={`url(#${id})`}/><rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="2"/>
    <rect x="16" y="16" width="32" height="15" rx="6" fill="#fff"/><rect x="10" y="27" width="11" height="21" rx="5.5" fill="#fff"/><rect x="43" y="27" width="11" height="21" rx="5.5" fill="#fff"/>
    <rect x="19" y="32" width="26" height="13" rx="4" fill="#fff" fillOpacity=".82"/><rect x="16" y="47" width="4" height="5" rx="2" fill="#fff"/><rect x="44" y="47" width="4" height="5" rx="2" fill="#fff"/>
    <circle cx="50" cy="14" r="6" fill="#fbbf24" stroke="#2dd4bf" strokeWidth="3"/>
  </svg>;
}
