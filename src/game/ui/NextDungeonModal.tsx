/**
 * Modal de mazmorra superada (GDD §10, run multi-mazmorra): se muestra en la
 * fase 'dungeon-cleared' — el jefe de esta mazmorra ha caído pero quedan más
 * jefes por delante en `session.bossSequence`. A diferencia de Victory/GameOver
 * NO reinicia nada: el botón llama a `advanceToNextDungeon` (conserva
 * hp/mejoras/estadísticas acumuladas) y el llamador (GameRoot) remonta el
 * canvas sin tocar el store de UI (hp/monedas/mejoras siguen).
 */

import { useUiStore } from '@/game/session/store';
import type { GameSession } from '@/game/session/session';
import { Button, Modal } from '@/ui';
import './modals.css';

export function NextDungeonModal({ session, onAdvance }: { session: GameSession; onAdvance: () => void }) {
  const phase = useUiStore((s) => s.phase);

  const isOpen = phase === 'dungeon-cleared';

  // session.stageIndex todavía apunta a la mazmorra recién superada (se
  // incrementa en advanceToNextDungeon, al pulsar el botón).
  const stageNumber = session.stageIndex + 1;
  const totalStages = session.bossSequence.length;

  return (
    <Modal
      open={isOpen}
      // Reutiliza el tono dorado de "victoria" (victory-modal): es, en
      // esencia, una victoria parcial.
      className="victory-modal"
      title="¡Jefe derrotado!"
      actions={
        <Button variant="primary" onClick={onAdvance}>
          Siguiente mazmorra
        </Button>
      }
    >
      <p className="modal-subtitle">
        Mazmorra {stageNumber} de {totalStages} superada
      </p>
    </Modal>
  );
}
