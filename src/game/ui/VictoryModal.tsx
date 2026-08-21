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
import { useT } from '@/i18n';
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
  const t = useT();
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
      title={t('victory.title')}
      actions={
        <>
          <Button variant="primary" onClick={onRestart}>
            {t('victory.playAgain')}
          </Button>
          {onExitToTitle && (
            <Button variant="secondary" onClick={onExitToTitle}>
              {t('gameOver.mainMenu')}
            </Button>
          )}
        </>
      }
    >
      <p className="modal-subtitle">{t('victory.subtitle')}</p>
      <dl className="game-over-stats">
        <div className="game-over-stat">
          <dt>{t('gameOver.roomsCleared')}</dt>
          <dd>{roomsCleared}</dd>
        </div>
        <div className="game-over-stat">
          <dt>{t('gameOver.coins')}</dt>
          <dd>{coins}</dd>
        </div>
        <div className="game-over-stat">
          <dt>{t('gameOver.score')}</dt>
          <dd>{score}</dd>
        </div>
      </dl>
      {acquiredUpgrades.length > 0 && (
        <section className="final-upgrade-section">
          <h3 className="pause-section-title">{t('gameOver.upgradesTitle')}</h3>
          <ul className="final-upgrade-list">
            {acquiredUpgrades.map((def) => (
              <li key={def.id} className="final-upgrade-item">
                <UpgradeIcon icon={def.icon} size={20} />
                <span className="final-upgrade-name">{t(`upgrades.${def.id}.name`)}</span>
                <UpgradeLevelPips level={getUpgradeLevel(hero, def.id)} maxLevel={def.maxLevel} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
