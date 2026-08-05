/**
 * Modal de victoria (GDD §10, run multi-mazmorra): fin de juego real — se
 * muestra tras limpiar la sala del ÚLTIMO jefe de `bossSequence`
 * (`world.isFinalDungeon`, ver step.ts::stepDungeonRoomClear). Estadísticas +
 * mejoras conseguidas (docs/plans/ECONOMY_PLAN.md F3, icono + pips) +
 * reinicio inmediato (nueva run, nueva semilla) o vuelta al menú. Usable con
 * el pulgar.
 */

import type { GameSession } from '@/game/session/session';
import { getUpgradeLevel, UPGRADE_POOL } from '@/game/session/upgrades';
import { useUiStore } from '@/game/session/store';
import { Button, Modal } from '@/ui';
import { UpgradeIcon, UpgradeLevelPips } from './UpgradeIcon';
import './modals.css';

export function VictoryModal({
  session,
  onRestart,
  onExitToTitle,
}: {
  session: GameSession;
  onRestart: () => void;
  onExitToTitle?: () => void;
}) {
  const phase = useUiStore((s) => s.phase);
  const roomsCleared = useUiStore((s) => s.roomsCleared);
  const coins = useUiStore((s) => s.coins);
  const score = useUiStore((s) => s.score);

  const isOpen = phase === 'victory';

  const hero = session.world.hero;
  const acquiredUpgrades = UPGRADE_POOL.filter((def) => getUpgradeLevel(hero, def.id) > 0);

  return (
    <Modal
      open={isOpen}
      className="victory-modal"
      title="¡Victoria!"
      actions={
        <>
          <Button variant="primary" onClick={onRestart}>
            Jugar otra run
          </Button>
          {onExitToTitle && (
            <Button variant="secondary" onClick={onExitToTitle}>
              Menú principal
            </Button>
          )}
        </>
      }
    >
      <p className="modal-subtitle">Has derrotado a todos los jefes</p>
      <dl className="game-over-stats">
        <div className="game-over-stat">
          <dt>Salas limpiadas</dt>
          <dd>{roomsCleared}</dd>
        </div>
        <div className="game-over-stat">
          <dt>Monedas</dt>
          <dd>{coins}</dd>
        </div>
        <div className="game-over-stat">
          <dt>Puntuación</dt>
          <dd>{score}</dd>
        </div>
      </dl>
      {acquiredUpgrades.length > 0 && (
        <section className="final-upgrade-section">
          <h3 className="pause-section-title">Mejoras conseguidas</h3>
          <ul className="final-upgrade-list">
            {acquiredUpgrades.map((def) => (
              <li key={def.id} className="final-upgrade-item">
                <UpgradeIcon icon={def.icon} size={20} />
                <span className="final-upgrade-name">{def.name}</span>
                <UpgradeLevelPips level={getUpgradeLevel(hero, def.id)} maxLevel={def.maxLevel} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
