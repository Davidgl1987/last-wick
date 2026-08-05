/**
 * Desplegable del kit: mismo patrón visual que `TextField` (etiqueta encima,
 * fondo `--ui-surface`, borde `--ui-line`, foco en `--ui-accent`, ver
 * select.css) sobre un `<select>` nativo — sin picker propio, para heredar
 * gratis su accesibilidad de teclado/táctil; aquí solo se retoca la piel y se
 * repone una flecha propia (el navegador quita la nativa con `appearance: none`).
 * Extiende `SelectHTMLAttributes` tal cual, mismo motivo que `TextField`: cada
 * futuro consumidor puede necesitar su propio `onChange`/`value` sin que el
 * kit se interponga.
 */

import { useId, type SelectHTMLAttributes } from 'react';
import './select.css';

interface SelectOwnProps {
  label: string;
  className?: string;
}

export type SelectProps = SelectOwnProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

export function Select({ label, className = '', id, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <label htmlFor={selectId} className={`select-field ${className}`.trim()}>
      <span className="select-field-label">{label}</span>
      <select id={selectId} className="select-field-input" {...rest}>
        {children}
      </select>
    </label>
  );
}
