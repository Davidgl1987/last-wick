/**
 * Desplegable del kit: mismo patrón visual que `TextField` (etiqueta encima,
 * fondo `--ui-surface`, borde `--ui-line`, foco en `--ui-accent`, ver
 * select.css) sobre un `<select>` nativo — sin picker propio, para heredar
 * gratis su accesibilidad de teclado/táctil; aquí solo se retoca la piel y se
 * repone una flecha propia (el navegador quita la nativa con `appearance: none`).
 * Extiende `SelectHTMLAttributes` tal cual, mismo motivo que `TextField`: cada
 * futuro consumidor puede necesitar su propio `onChange`/`value` sin que el
 * kit se interponga.
 *
 * `labelClassName` (opcional): el selector de idioma de la pantalla de
 * título (TitleScreen.tsx) necesita la etiqueta accesible para lectores de
 * pantalla pero invisible en pantalla (no debe competir con el resto del
 * chrome); el de PauseModal la deja visible como cualquier otro campo. Sin
 * esto no hay forma de aplicar `.sr-only` al `<span>` interior desde fuera:
 * `className` ya está tomado por el contenedor `<label>`.
 */

import { useId, type SelectHTMLAttributes } from 'react';
import './select.css';

interface SelectOwnProps {
  label: string;
  className?: string;
  /** Clase extra para el `<span>` de la etiqueta (p.ej. `sr-only`, ver styles/base.css): la etiqueta sigue existiendo para lectores de pantalla, pero puede ocultarse visualmente sin tocar el resto del componente. */
  labelClassName?: string;
}

export type SelectProps = SelectOwnProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

export function Select({ label, className = '', labelClassName, id, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <label htmlFor={selectId} className={`select-field ${className}`.trim()}>
      <span className={labelClassName ? `select-field-label ${labelClassName}` : 'select-field-label'}>{label}</span>
      <select id={selectId} className="select-field-input" {...rest}>
        {children}
      </select>
    </label>
  );
}
