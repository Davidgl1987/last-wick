/**
 * Marco decorativo 9-slice (Kenney Fantasy UI Borders): envoltorio de
 * `frame.css` (mecanismo `.ui-frame`, ver ese fichero para el porqué de la
 * técnica de máscara). 4 variantes = 4 assets de `public/ui/` (ver README de
 * esa carpeta):
 *   - ornate → panel-border-029.png (greca elegante, botón/acción primaria)
 *   - plain  → panel-border-009.png (marco sobrio, elementos secundarios)
 *   - rich   → panel-border-026.png (greca doble rica, paneles de modal)
 *   - inset  → panel-border-021.png (greca hacia dentro, marco ambiental)
 *
 * `frameClass(variant)` se expone aparte para los casos donde OTRO componente
 * (Button, Modal) necesita las clases del marco sobre su propio elemento raíz
 * en vez de envolver con un nodo extra — así no se duplica el CSS de arriba.
 */

import { createElement, type ComponentPropsWithoutRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import './frame.css';

export type FrameVariant = 'ornate' | 'plain' | 'rich' | 'inset';

/** `--ui-frame-color` es una custom property: CSSProperties no la declara por defecto. */
type FrameCSSProperties = CSSProperties & { '--ui-frame-color'?: string };

/** Clases que ponen el marco `variant` sobre CUALQUIER elemento (ver cabecera). */
export function frameClass(variant: FrameVariant, className = ''): string {
  return `ui-frame frame-${variant}${className ? ` ${className}` : ''}`;
}

interface FrameOwnProps {
  variant: FrameVariant;
  /** Sobreescribe el `--ui-frame-color` por defecto de la variante (ej. el tinte por arma de WeaponBar). */
  color?: string;
  /** Etiqueta a renderizar; `div` por defecto. */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

/** Resto de props válidas para la etiqueta elegida (aria-*, onClick, role, etc.). */
export type FrameProps = FrameOwnProps & Omit<ComponentPropsWithoutRef<'div'>, keyof FrameOwnProps>;

export function Frame({ variant, color, as, className = '', style, children, ...rest }: FrameProps) {
  const Component: ElementType = as ?? 'div';
  const mergedStyle: FrameCSSProperties | undefined = color ? { ...style, '--ui-frame-color': color } : style;
  // `createElement` en vez de JSX: con `Component` tipado como `ElementType`
  // genérico, JSX intersecta las props de TODAS las etiquetas posibles (acaba
  // en `never` para las que no comparten). `createElement` no tiene ese problema.
  return createElement(Component, { className: frameClass(variant, className), style: mergedStyle, ...rest }, children);
}
