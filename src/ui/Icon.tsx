/**
 * Registro de iconos SVG del kit: siluetas simples de 24x24, legibles a
 * ~20px, con `fill="currentColor"` por defecto para heredar color por CSS
 * (igual que el resto de la UI). Sustituyen a los caracteres/emoji sueltos
 * que había en la UI del juego:
 *   - `flame`: unidad de vida del HUD (antes FlameIcon.tsx, movido aquí) y
 *     modo de ataque "Fuego" en WeaponBar.
 *   - `pause`: botón de pausa del HUD (antes el texto "❚❚").
 *   - `key`: llave del HUD (antes el emoji "🗝", que además rendería con la
 *     tipografía emoji del sistema en vez del estilo del juego).
 *   - `dot` / `spark`: modos de ataque "Cera"/"Hechizo" en WeaponBar (antes
 *     los caracteres "●"/"✦").
 *   - `chevron`: flecha simple de una punta, apunta ARRIBA por defecto;
 *     rota con `style={{ transform: 'rotate(90deg)' }}` (0/90/180/-90 =
 *     arriba/derecha/abajo/izquierda) en vez de registrar 4 iconos casi
 *     idénticos. Sustituye "←"/"↑"/"↓"/"→" del editor de niveles (volver al
 *     juego, selector de lado de la púa/impulso).
 *   - `play`: acción "Probar" (playtest) del editor (antes "▶").
 *   - `check`: validación en verde del editor (antes "✓").
 *   - `close`: quitar/cerrar (antes "×") — hueco de puerta del editor.
 *   - `target`: marcador de "inicio del jugador" en la paleta del editor
 *     (antes "⦿").
 *
 * `UpgradeIcon.tsx` (catálogo de iconos de mejoras) es un módulo aparte con
 * su propia lógica de categoría/color — no se ha tocado ni se mueve aquí.
 */

import type { ReactNode, SVGAttributes } from 'react';
import './icon.css';

export type IconName = 'flame' | 'pause' | 'key' | 'dot' | 'spark' | 'chevron' | 'play' | 'check' | 'close' | 'target';

function renderGlyph(name: IconName): ReactNode {
  switch (name) {
    case 'flame':
      // Punta hacia arriba, hendidura en la base (unidad de vida / ataque "Fuego").
      return <path d="M12 2C9.8 5.5 6 10 6 14c0 2.8 1.6 5 3.6 6.3.7-1.6 1.4-3.3 2.4-4.5 1 1.2 1.7 2.9 2.4 4.5C16.4 19 18 16.8 18 14c0-4-3.8-8.5-6-12Z" />;
    case 'pause':
      // Dos barras verticales.
      return (
        <>
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </>
      );
    case 'key':
      // Anillo (bow) + paletón en diagonal, silueta de línea.
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="4.3" />
          <path d="M11 11 L20.5 20.5" />
          <path d="M15.3 15.3 L17.7 13" />
          <path d="M17.9 17.9 L20.3 15.6" />
        </g>
      );
    case 'dot':
      // Bola llena (modo de ataque "Cera").
      return <circle cx="12" cy="12" r="6" />;
    case 'spark':
      // Destello de 4 puntas (modo de ataque "Hechizo").
      return <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />;
    case 'chevron':
      // Ángulo simple apuntando arriba — se rota por CSS en cada uso (ver cabecera).
      return (
        <path
          d="M6 15 L12 9 L18 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'play':
      // Triángulo (botón "Probar" del editor).
      return <path d="M8 5 L19 12 L8 19 Z" />;
    case 'check':
      // Marca de validación correcta.
      return (
        <path
          d="M4 12 L9 17 L20 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'close':
      // Aspa de quitar/cerrar.
      return (
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6 L18 18" />
          <path d="M18 6 L6 18" />
        </g>
      );
    case 'target':
      // Anillo + punto central (marcador de inicio del jugador).
      return (
        <g>
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.6" />
        </g>
      );
    default:
      return null;
  }
}

interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, className = '', ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`icon ${className}`.trim()}
      aria-hidden="true"
      {...rest}
    >
      {renderGlyph(name)}
    </svg>
  );
}
