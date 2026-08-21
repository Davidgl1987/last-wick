/**
 * Badge visual de mejora (docs/plans/ECONOMY_PLAN.md F3): un SVG inline
 * pequeño y distintivo por cada uno de los 12 ids del pool (`UPGRADE_POOL`,
 * session/upgrades.ts), coloreado por CATEGORÍA. Los colores de cuerpo/flecha/
 * hechizo son los MISMOS que usan WeaponBar/HeroView (`WEAPON_COLOR`,
 * render/assets.ts) para mapeo instantáneo con el arma equivalente;
 * consumible usa un verde propio (no hay arma consumible con la que
 * alinearse). Sin dependencias nuevas: solo SVG inline.
 *
 * `UpgradeLevelPips` (mismo módulo, misma razón de ser: van siempre juntos en
 * las tarjetas) dibuja el nivel actual como ●●○; el escudo (maxLevel
 * Infinity, stack sin tope) muestra un contador `×N` en vez de pips.
 */

import type { UpgradeCategory } from '@/game/session/upgrades';
import { useT } from '@/i18n';
import './upgrade-icon.css';

/** Acento de color por categoría — cuerpo/flecha/hechizo calcados de WEAPON_COLOR (render/assets.ts). */
const CATEGORY_COLOR: Record<UpgradeCategory, string> = {
  cuerpo: '#fef08a',
  flecha: '#54c7ff',
  hechizo: '#d8b4fe',
  consumible: '#7bd88f',
};

type IconId =
  | 'spikes'
  | 'comet'
  | 'boulder'
  | 'fang'
  | 'flock'
  | 'needle'
  | 'orb'
  | 'choir'
  | 'echo'
  | 'bubble'
  | 'ember'
  | 'magpie';

/** Categoría de cada icono (para el color del badge) — calcado 1:1 de `UPGRADE_POOL`. */
const ICON_CATEGORY: Record<IconId, UpgradeCategory> = {
  spikes: 'cuerpo',
  comet: 'cuerpo',
  boulder: 'cuerpo',
  fang: 'flecha',
  flock: 'flecha',
  needle: 'flecha',
  orb: 'hechizo',
  choir: 'hechizo',
  echo: 'hechizo',
  bubble: 'consumible',
  ember: 'consumible',
  magpie: 'consumible',
};

function isIconId(icon: string): icon is IconId {
  return icon in ICON_CATEGORY;
}

/** Glifo de 24×24 por icono, legible a 20-32px (formas simples, pocos trazos). */
function renderGlyph(icon: IconId, color: string) {
  switch (icon) {
    case 'spikes':
      // Bola con pinchos pequeños alrededor (Erizo de Acero).
      return (
        <g stroke={color} strokeWidth="1.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const x1 = 12 + Math.cos(rad) * 4.8;
            const y1 = 12 + Math.sin(rad) * 4.8;
            const x2 = 12 + Math.cos(rad) * 9.4;
            const y2 = 12 + Math.sin(rad) * 9.4;
            return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
      );
    case 'comet':
      // Bola que se estira más al moverse, con estela (Estela de Cometa).
      return (
        <g>
          <circle cx="15.5" cy="8.5" r="3.2" fill={color} />
          <path
            d="M13.2 10.3 C9.5 12.3, 6 14.6, 3.4 19"
            fill="none"
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.75"
          />
          <path
            d="M11.6 12.4 C8.6 14.3, 6.3 16.2, 4.6 19.6"
            fill="none"
            stroke={color}
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.45"
          />
        </g>
      );
    case 'boulder':
      // Bola más grande con facetas de roca (Canto Rodado).
      return (
        <g fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="7.6" fill={`${color}33`} stroke={color} />
          <path d="M12 5.2 L12 10.8 L17 13.6" />
          <path d="M12 10.8 L7.4 13.8" />
          <path d="M12 10.8 L12 17.8" />
        </g>
      );
    case 'fang':
      // Punta de flecha ancha (Colmillo de Hierro).
      return (
        <g fill={color}>
          <path d="M4 12 L14.5 7.5 L14.5 10 L20 10 L20 14 L14.5 14 L14.5 16.5 Z" />
        </g>
      );
    case 'flock': {
      // Tres flechas en abanico (Bandada).
      const arrow = 'M4 9.2 L15 12 L4 14.8 L7 12 Z';
      return (
        <g fill={color}>
          <path d={arrow} transform="rotate(-18 12 12)" opacity="0.55" />
          <path d={arrow} />
          <path d={arrow} transform="rotate(18 12 12)" opacity="0.55" />
        </g>
      );
    }
    case 'needle':
      // Aguja fina atravesando enemigos (Aguja Fantasma).
      return (
        <g>
          <line x1="3" y1="12" x2="20" y2="12" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M17.5 9 L22 12 L17.5 15 Z" fill={color} />
          <circle cx="7.5" cy="12" r="1.5" fill="none" stroke={color} strokeWidth="1.2" opacity="0.6" />
          <circle cx="12.5" cy="12" r="1.5" fill="none" stroke={color} strokeWidth="1.2" opacity="0.6" />
        </g>
      );
    case 'orb':
      // Orbe con anillo (Orbe Voraz).
      return (
        <g fill="none" stroke={color} strokeWidth="1.3">
          <circle cx="12" cy="12" r="5" fill={`${color}55`} stroke="none" />
          <circle cx="12" cy="12" r="8" opacity="0.5" strokeDasharray="2 2.2" />
        </g>
      );
    case 'choir':
      // Tres chispas (Coro Arcano).
      return (
        <g fill={color}>
          <circle cx="8" cy="8.4" r="2.1" opacity="0.55" />
          <circle cx="12" cy="12.6" r="2.6" />
          <circle cx="16" cy="8.4" r="2.1" opacity="0.55" />
        </g>
      );
    case 'echo':
      // Flecha rebotando contra un muro (Eco Errante).
      return (
        <g fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18.5" y1="4.5" x2="18.5" y2="19.5" opacity="0.45" strokeWidth="1.3" />
          <path d="M4 7.5 L14 12 L4 16.5" />
          <path d="M14 12 L18.5 12" opacity="0.6" strokeDasharray="1.6 1.6" />
        </g>
      );
    case 'bubble':
      // Esfera semitransparente (Burbuja de Cuarzo).
      return (
        <g>
          <circle cx="12" cy="12" r="8" fill={`${color}22`} stroke={color} strokeWidth="1.3" />
          <ellipse
            cx="9"
            cy="8.4"
            rx="2.1"
            ry="1.2"
            fill={color}
            opacity="0.6"
            transform="rotate(-30 9 8.4)"
          />
        </g>
      );
    case 'ember':
      // Corazón/ascua (Ascua Vital).
      return (
        <path
          d="M12 18.6 C7.3 15, 3.9 12.2, 3.9 8.8 C3.9 6.4, 5.8 4.6, 8.1 4.6 C9.6 4.6, 11 5.5, 12 6.9 C13 5.5, 14.4 4.6, 15.9 4.6 C18.2 4.6, 20.1 6.4, 20.1 8.8 C20.1 12.2, 16.7 15, 12 18.6 Z"
          fill={color}
        />
      );
    case 'magpie':
      // Moneda con ondas de atracción (Canto de Urraca).
      return (
        <g fill="none" stroke={color} strokeWidth="1.3">
          <circle cx="9" cy="13.5" r="5" fill={`${color}33`} />
          <circle cx="9" cy="13.5" r="2.4" opacity="0.7" />
          <path d="M16 8.2 a6.2 6.2 0 0 1 0 8.6" opacity="0.55" />
          <path d="M18.6 6 a9.2 9.2 0 0 1 0 13" opacity="0.35" />
        </g>
      );
    default:
      return null;
  }
}

export function UpgradeIcon({ icon, size = 28 }: { icon: string; size?: number }) {
  const iconId: IconId = isIconId(icon) ? icon : 'orb';
  const category = ICON_CATEGORY[iconId];
  const color = CATEGORY_COLOR[category];
  return (
    <svg
      className="upgrade-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11.2" fill={`${color}22`} stroke={color} strokeWidth="1.1" />
      {renderGlyph(iconId, color)}
    </svg>
  );
}

/**
 * Pips de nivel (●●○): `level`/`maxLevel` actuales. `previewLevel` (opcional,
 * BossRewardModal/tienda F4) pinta además el pip "nuevo" en un estilo
 * intermedio para mostrar nivel actual → nivel nuevo de un vistazo.
 *
 * Escudo (maxLevel === Infinity, stack sin tope): pips ilimitados no son
 * legibles, así que se muestra el contador de cargas (`×N`) en su lugar.
 */
export function UpgradeLevelPips({
  level,
  maxLevel,
  previewLevel,
}: {
  level: number;
  maxLevel: number;
  previewLevel?: number;
}) {
  const t = useT();
  if (!Number.isFinite(maxLevel)) {
    return (
      <span className="upgrade-pips upgrade-pips-stack">
        ×{level}
        {previewLevel !== undefined && previewLevel !== level ? ` → ×${previewLevel}` : ''}
      </span>
    );
  }
  const target = previewLevel ?? level;
  return (
    <span className="upgrade-pips" aria-label={t('upgradeIcon.levelAria', { level, maxLevel })}>
      {Array.from({ length: maxLevel }, (_, i) => {
        const pipLevel = i + 1;
        let cls = 'upgrade-pip';
        if (pipLevel <= level) cls += ' upgrade-pip-filled';
        else if (pipLevel <= target) cls += ' upgrade-pip-preview';
        return <span key={i} className={cls} />;
      })}
    </span>
  );
}
