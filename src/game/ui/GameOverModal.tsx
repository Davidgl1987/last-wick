/**
 * Modal de fin de run (GDD §6/§12): estadísticas (salas limpiadas, monedas,
 * puntuación) + mejoras conseguidas (docs/plans/ECONOMY_PLAN.md F3, icono +
 * pips) y botón de reinicio inmediato. Usable con el pulgar.
 */

import type { GameSession } from '@/game/session/session';
import { getUpgradeLevel, UPGRADE_POOL } from '@/game/session/upgrades';
import { useUiStore } from '@/game/session/store';
import { Button, Modal } from '@/ui';
import { useT } from '@/i18n';
import { UpgradeIcon, UpgradeLevelPips } from './UpgradeIcon';
import './modals.css';

export function GameOverModal({
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

  const isOpen = phase === 'game-over';

  const hero = session.world.hero;
  const acquiredUpgrades = UPGRADE_POOL.filter((def) => getUpgradeLevel(hero, def.id) > 0);

  return (
    <Modal
      open={isOpen}
      className="game-over-modal"
      title={t('gameOver.title')}
      actions={
        <>
          <Button variant="primary" onClick={onRestart}>
            {t('gameOver.retry')}
          </Button>
          {onExitToTitle && (
            <Button variant="secondary" onClick={onExitToTitle}>
              {t('gameOver.mainMenu')}
            </Button>
          )}
        </>
      }
    >
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
