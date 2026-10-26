import type { ReactNode } from 'react';
export function FormField({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) { return <div className="form-field-ui"><label htmlFor={id}>{label}</label>{children}{hint ? <p>{hint}</p> : null}</div>; }
