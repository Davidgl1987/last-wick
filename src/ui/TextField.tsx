/**
 * Campo de texto/número del kit: etiqueta encima de un `<input>` nativo con
 * la piel de la UI (fondo `--ui-surface`, borde recto `--ui-line`, foco en
 * `--ui-accent`, ver text-field.css). A diferencia de `Slider`/`Checkbox` NO
 * envuelve `onChange` en un callback con el valor ya convertido: el editor de
 * niveles (su único consumidor hoy) tiene una lógica de parseo distinta en
 * cada campo (número vs texto, borrar la prop si el valor queda vacío, clamps
 * puntuales — ver `EnemyProperties`/`HazardProperties`), así que extiende
 * `InputHTMLAttributes` tal cual y dejamos pasar el evento nativo.
 *
 * `hideLabel` oculta el texto de la etiqueta (visualmente, no del árbol de
 * accesibilidad) para los campos donde el contexto ya la muestra por fuera
 * (ej. el offset de un hueco de puerta junto a su lado "Norte"/"Sur"/...).
 */

import { useId, type InputHTMLAttributes } from 'react';
import './text-field.css';

interface TextFieldOwnProps {
  label: string;
  hideLabel?: boolean;
  className?: string;
}

export type TextFieldProps = TextFieldOwnProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export function TextField({ label, hideLabel = false, className = '', id, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label htmlFor={inputId} className={`text-field ${className}`.trim()}>
      <span className={`text-field-label${hideLabel ? ' text-field-label-hidden' : ''}`}>{label}</span>
      <input id={inputId} className="text-field-input" {...rest} />
    </label>
  );
}
