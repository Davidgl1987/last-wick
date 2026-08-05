/**
 * Checkbox del kit (ver checkbox.css para el porqué de la casilla cuadrada).
 */

import { useId, type ChangeEvent } from 'react';
import './checkbox.css';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function Checkbox({ label, checked, onChange, className = '' }: CheckboxProps) {
  const id = useId();

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };

  return (
    <label htmlFor={id} className={`checkbox-row ${className}`.trim()}>
      <input id={id} type="checkbox" className="checkbox-input" checked={checked} onChange={handleChange} />
      {label}
    </label>
  );
}
