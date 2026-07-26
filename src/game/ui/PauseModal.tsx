/**
 * Modal de pausa (GDD §12): mejoras acumuladas + leyenda del juego (colores
 * de enemigos/hazards) + ajuste de cámara + reanudar/reiniciar. La sim ya
 * está detenida por fase ('paused') antes de que este modal se muestre; aquí
 * solo se reanuda (vuelve a 'playing') o se reinicia la run entera.
 *
 * Leyenda como acordeón (ronda 3, punto 4): `<details>/<summary>` nativos
 * (accesibles por defecto: foco de teclado, semántica de disclosure sin JS
 * propio), plegados de entrada — la leyenda es consulta ocasional, no debe
 * competir en altura con las mejoras acumuladas al abrir pausa.
 *
 * Slider de distancia de cámara (ronda 3, punto 5): controla
 * `cameraSettings.distanceScale` (módulo mutable fuera de React, ver
 * cameraSettings.ts), leído por CameraRig en useFrame; persiste solo en
 * localStorage (no en zustand: no debe disparar re-render del canvas).
 */

import { useState, type ChangeEvent } from 'react';
import {
  CAMERA_DISTANCE_SCALE_MAX,
  CAMERA_DISTANCE_SCALE_MIN,
  cameraSettings,
  setCameraDistanceScale,
} from '@/game/render/cameraSettings';
import { setPostEffectEnabled, usePostSettings, type PostSettings } from '@/game/render/postSettings';
import { resumeGame, type GameSession } from '@/game/session/session';
import { getUpgradeLevel, UPGRADE_POOL } from '@/game/session/upgrades';
import { useUiStore } from '@/game/session/store';
import { UpgradeIcon, UpgradeLevelPips } from './UpgradeIcon';
import './modals.css';

const ENEMY_LEGEND: { label: string; color: string }[] = [
  { label: 'Dummy — básico', color: '#ff5964' },
  { label: 'Chaser — perseguidor', color: '#ff9f45' },
  { label: 'Spike — erizo (púa daña)', color: '#9aa1bd' },
  { label: 'Trail — deja charcos', color: '#4dd68a' },
  { label: 'Shooter — dispara a distancia', color: '#2b2f42' },
];

const HAZARD_LEGEND: { label: string; color: string }[] = [
  { label: 'Foso — caes y pierdes 1 corazón', color: '#05060a' },
  { label: 'Pinchos — daño + empujón', color: '#8d94ad' },
  { label: 'Barril — explota, daño en área', color: '#c0442b' },
  { label: 'Barro — te frena', color: '#6b4a2f' },
  { label: 'Acelerador — te impulsa', color: '#3fd0ff' },
];

/**
 * Los 4 toggles se crean YA en esta fase 1, aunque Bloom y ChromaticAberration
 * todavía no monten ningún efecto real en PostEffects.tsx (llegan en fases 2 y
 * 3) — así el checkbox y su persistencia en localStorage quedan listos de
 * antemano y las fases siguientes solo añaden el `<Effect>` correspondiente.
 */
const POST_EFFECT_TOGGLES: { key: keyof PostSettings; label: string }[] = [
  { key: 'bloom', label: 'Bloom (brillos)' },
  { key: 'vignette', label: 'Viñeta' },
  { key: 'noise', label: 'Grano de imagen' },
  { key: 'chromaticAberration', label: 'Aberración cromática (impactos)' },
];

export function PauseModal({ session, onRestart }: { session: GameSession; onRestart: () => void }) {
  const phase = useUiStore((s) => s.phase);
  // Leídas directamente de la sim (no del store zustand): las mejoras no
  // cambian cada frame, pero tampoco justifican duplicar estado — este modal
  // solo se muestra en 'paused', así que basta con leer al abrir.
  const hero = session.world.hero;
  const acquiredUpgrades = UPGRADE_POOL.filter((def) => getUpgradeLevel(hero, def.id) > 0);
  // Estado local SOLO para reflejar la posición del slider en el input (no es
  // estado de juego, no pasa por zustand ni por la sim): el valor real que
  // lee CameraRig vive en `cameraSettings.distanceScale` (fuera de React).
  const [distanceScale, setDistanceScale] = useState(cameraSettings.distanceScale);
  // Suscripción reactiva (ver postSettings.ts): a diferencia del slider de
  // cámara de arriba, aquí SÍ queremos que cambiar un checkbox re-renderice
  // (para reflejar el estado marcado) — usePostSettings ya se encarga de eso.
  const postSettings = usePostSettings();

  if (phase !== 'paused') return null;

  const handleResume = () => {
    resumeGame(session);
  };

  const handleDistanceChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(e.target.value);
    setCameraDistanceScale(value);
    setDistanceScale(cameraSettings.distanceScale);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal pause-modal">
        <h2 className="modal-title">Pausa</h2>

        <section className="pause-section">
          <h3 className="pause-section-title">Mejoras acumuladas</h3>
          {acquiredUpgrades.length === 0 ? (
            <p className="pause-empty">Ninguna todavía.</p>
          ) : (
            <ul className="pause-upgrade-list">
              {acquiredUpgrades.map((def) => {
                const level = getUpgradeLevel(hero, def.id);
                return (
                  <li key={def.id} className="pause-upgrade-item">
                    <UpgradeIcon icon={def.icon} size={24} />
                    <div className="pause-upgrade-info">
                      <strong>{def.name}</strong>
                      <UpgradeLevelPips level={level} maxLevel={def.maxLevel} />
                      <span className="pause-upgrade-desc">{def.description}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="pause-section">
          <h3 className="pause-section-title">Cámara</h3>
          <label className="pause-camera-slider">
            <span>Distancia (alejar / acercar)</span>
            <input
              type="range"
              min={CAMERA_DISTANCE_SCALE_MIN}
              max={CAMERA_DISTANCE_SCALE_MAX}
              step={0.01}
              value={distanceScale}
              onChange={handleDistanceChange}
              aria-label="Distancia de cámara"
            />
          </label>
        </section>

        <section className="pause-section">
          <h3 className="pause-section-title">Efectos visuales</h3>
          <ul className="pause-effects-list">
            {POST_EFFECT_TOGGLES.map(({ key, label }) => (
              <li key={key}>
                <label className="pause-effect-toggle">
                  <input
                    type="checkbox"
                    checked={postSettings[key]}
                    onChange={(e) => setPostEffectEnabled(key, e.target.checked)}
                  />
                  {label}
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="pause-section">
          <details className="pause-accordion">
            <summary className="pause-section-title">Enemigos</summary>
            <ul className="pause-legend">
              {ENEMY_LEGEND.map((e) => (
                <li key={e.label}>
                  <span className="pause-legend-swatch" style={{ background: e.color }} />
                  {e.label}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="pause-section">
          <details className="pause-accordion">
            <summary className="pause-section-title">Hazards</summary>
            <ul className="pause-legend">
              {HAZARD_LEGEND.map((h) => (
                <li key={h.label}>
                  <span className="pause-legend-swatch" style={{ background: h.color }} />
                  {h.label}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <div className="pause-actions">
          <button type="button" className="modal-primary-btn" onClick={handleResume}>
            Reanudar
          </button>
          <button type="button" className="modal-secondary-btn" onClick={onRestart}>
            Reiniciar run
          </button>
        </div>
      </div>
    </div>
  );
}
