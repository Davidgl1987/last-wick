/**
 * Modal de créditos, abierto desde el botón "Créditos" de la pantalla de
 * título (TitleScreen). Estado puramente local a la pantalla de título — no
 * pasa por la sesión de juego ni por el store de fases (a diferencia de los
 * modales de partida como PauseModal), así que aquí no hay `useUiStore`.
 *
 * Usa `Modal` del kit (backdrop + cierre con Escape/clic fuera ya incluidos
 * al pasar `onClose`) — el CSS propio de este fichero se retiró: ya no queda
 * nada específico de créditos que no cubra el kit (panel, título, botón).
 */

import { Button, Modal } from '@/ui';
import './modals.css';

const CREDIT_SECTIONS: { label: string; value: string }[] = [
  { label: 'Diseño y programación', value: 'David García López' },
  { label: 'Interfaz', value: 'Kenney · Fantasy UI Borders (CC0)' },
  { label: 'Tipografías', value: 'Cinzel Decorative · Cormorant Garamond' },
  { label: 'Motor', value: 'three.js · React Three Fiber' },
];

export function CreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Créditos"
      onClose={onClose}
      actions={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {CREDIT_SECTIONS.map((section) => (
        <div key={section.label} className="credits-section">
          <span className="credits-label">{section.label}</span>
          <span className="credits-value">{section.value}</span>
        </div>
      ))}
    </Modal>
  );
}
