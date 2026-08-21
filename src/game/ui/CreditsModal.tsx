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
import { type TranslationKey, useT } from '@/i18n';
import './modals.css';

// Los VALORES son nombres propios/atribuciones — no se traducen, se quedan
// aquí tal cual (solo las ETIQUETAS de sección salen de i18n).
const CREDIT_SECTIONS: { labelKey: TranslationKey; value: string }[] = [
  { labelKey: 'credits.design', value: 'David García López' },
  { labelKey: 'credits.ui', value: 'Kenney · Fantasy UI Borders (CC0)' },
  // CC0: la atribución no es obligatoria, se pone igual (mismo criterio que
  // con Kenney). Licencia completa en public/models/kaykit/LICENSE-kaykit.txt.
  { labelKey: 'credits.scenery', value: 'KayKit · Dungeon Pack, de Kay Lousberg (CC0)' },
  // CC0, misma nota que arriba. Licencia completa en
  // public/textures/vfx/LICENSE-kenney.txt (docs/plans/VFX_PLAN.md).
  { labelKey: 'credits.vfx', value: 'Kenney · Light Masks + Splat Pack (CC0)' },
  { labelKey: 'credits.fonts', value: 'Cinzel Decorative · Cormorant Garamond' },
  { labelKey: 'credits.sound', value: '400 Sounds Pack' },
  { labelKey: 'credits.engine', value: 'three.js · React Three Fiber' },
];

export function CreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Modal
      open={open}
      title={t('credits.title')}
      onClose={onClose}
      actions={
        <Button variant="secondary" onClick={onClose}>
          {t('credits.close')}
        </Button>
      }
    >
      {CREDIT_SECTIONS.map((section) => (
        <div key={section.labelKey} className="credits-section">
          <span className="credits-label">{t(section.labelKey)}</span>
          <span className="credits-value">{section.value}</span>
        </div>
      ))}
    </Modal>
  );
}
