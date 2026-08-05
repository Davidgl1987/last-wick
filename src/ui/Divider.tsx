/**
 * Divisor ornamental del kit (ver divider.css). `width` opcional para
 * cambiar el ancho por defecto (220px) según el contexto.
 */

import type { CSSProperties } from 'react';
import './divider.css';

interface DividerProps {
  width?: number | string;
  className?: string;
}

export function Divider({ width, className = '' }: DividerProps) {
  const style: CSSProperties | undefined =
    width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : undefined;
  return (
    <div className={`divider ${className}`.trim()} style={style} aria-hidden="true">
      <span className="divider-half divider-half-left" />
      <span className="divider-half divider-half-right" />
    </div>
  );
}
