/**
 * Slider del kit: fila etiqueta | pista | valor (ver slider.css para el
 * porqué del pulgar cuadrado y el relleno de la pista). `formatValue` decide
 * cómo se lee el valor a la derecha (ej. "80 %" en los volúmenes); por
 * defecto se muestra el número tal cual.
 */

import { useId, type ChangeEvent, type CSSProperties } from 'react';
import './slider.css';

/** `--slider-percent` es una custom property: CSSProperties no la declara por defecto. */
type SliderCSSProperties = CSSProperties & { '--slider-percent'?: string };

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  className?: string;
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue = (v) => String(v),
  className = '',
}: SliderProps) {
  const id = useId();
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const style: SliderCSSProperties = { '--slider-percent': `${percent}%` };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number.parseFloat(e.target.value));
  };

  return (
    <label htmlFor={id} className={`slider-row ${className}`.trim()}>
      <span className="slider-label">{label}</span>
      <input
        id={id}
        type="range"
        className="slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        style={style}
      />
      <span className="slider-value">{formatValue(value)}</span>
    </label>
  );
}
