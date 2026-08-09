/**
 * Modal de pausa (GDD §12): mejoras acumuladas + ajustes (Sonido, Cámara,
 * Efectos visuales) + reanudar/salir. La sim ya está detenida por fase
 * ('paused') antes de que este modal se muestre; aquí solo se reanuda
 * (vuelve a 'playing') o se sale al menú principal.
 *
 * La leyenda de Enemigos/Hazards (acordeón de la ronda 3) se retiró: no
 * aportaba tras el rediseño visual, y este modal ya es largo de por sí.
 *
 * Slider de distancia de cámara (ronda 3, punto 5): controla
 * `cameraSettings.distanceScale` (módulo mutable fuera de React, ver
 * cameraSettings.ts), leído por CameraRig en useFrame; persiste solo en
 * localStorage (no en zustand: no debe disparar re-render del canvas).
 *
 * Sonido: sliders conectados a `audioSettings.ts`, que a su vez alimenta el
 * motor Web Audio real (`audio/sfxEngine.ts`) — arrastrar un slider aquí sube
 * o baja el volumen audible en el acto (rampa corta para no chasquear, ver
 * cabecera de `sfxEngine.ts`), no solo la preferencia persistida.
 *
 * Un `Divider` separa el resumen de la partida (mejoras acumuladas) del resto
 * de secciones, que ya son ajustes — pedido explícito de David.
 *
 * Usa `Modal` del kit: el propio `<Modal>` no scrollea (así su marco queda
 * fijo), el contenido largo scrollea en su `.modal-body` interior, y
 * `actions` (Continuar/Salir) queda fuera del área de scroll, siempre visible.
 */

import { useState } from 'react';
import { type AudioSettings, setAudioVolume, useAudioSettings } from '@/game/audio/audioSettings';
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
import { Button, Checkbox, Divider, Modal, Slider } from '@/ui';
import { UpgradeIcon, UpgradeLevelPips } from './UpgradeIcon';
import './modals.css';

/** Los 3 volúmenes de audioSettings.ts, en el orden que se muestran. */
const AUDIO_SLIDERS: { key: keyof AudioSettings; label: string }[] = [
  { key: 'master', label: 'General' },
  { key: 'music', label: 'Música' },
  { key: 'sfx', label: 'Efectos' },
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

export function PauseModal({ session, onExitToTitle }: { session: GameSession; onExitToTitle?: () => void }) {
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
  // Misma suscripción reactiva que postSettings, ver audioSettings.ts.
  const audioSettings = useAudioSettings();

  const isOpen = phase === 'paused';

  const handleResume = () => {
    resumeGame(session);
  };

  const handleDistanceChange = (value: number) => {
    setCameraDistanceScale(value);
    setDistanceScale(cameraSettings.distanceScale);
  };

  return (
    <Modal
      open={isOpen}
      className="pause-modal"
      title="Pausa"
      actions={
        <>
          <Button variant="primary" onClick={handleResume}>
            Continuar
          </Button>
          {onExitToTitle && (
            <Button variant="secondary" onClick={onExitToTitle}>
              Salir
            </Button>
          )}
        </>
      }
    >
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

      <Divider />

      <section className="pause-section">
        <h3 className="pause-section-title">Sonido</h3>
        <ul className="pause-audio-list">
          {AUDIO_SLIDERS.map(({ key, label }) => (
            <li key={key}>
              <Slider
                label={label}
                value={audioSettings[key]}
                onChange={(value) => setAudioVolume(key, value)}
                min={0}
                max={1}
                step={0.01}
                formatValue={(value) => `${Math.round(value * 100)} %`}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="pause-section">
        <h3 className="pause-section-title">Cámara</h3>
        <Slider
          label="Distancia (alejar / acercar)"
          value={distanceScale}
          onChange={handleDistanceChange}
          min={CAMERA_DISTANCE_SCALE_MIN}
          max={CAMERA_DISTANCE_SCALE_MAX}
          step={0.01}
          formatValue={(value) => `${value.toFixed(2)}×`}
        />
      </section>

      <section className="pause-section">
        <h3 className="pause-section-title">Efectos visuales</h3>
        <ul className="pause-effects-list">
          {POST_EFFECT_TOGGLES.map(({ key, label }) => (
            <li key={key}>
              <Checkbox
                label={label}
                checked={postSettings[key]}
                onChange={(checked: boolean) => setPostEffectEnabled(key, checked)}
              />
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}
