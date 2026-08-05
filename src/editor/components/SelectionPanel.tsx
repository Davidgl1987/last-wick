import type { EnemySpawn, HazardSpawn, ItemSpawn } from '@/game/world/types';
import type { Selection } from '@/editor/types';
import { Button } from '@/ui';
import { EnemyProperties } from './EnemyProperties';
import { HazardProperties } from './HazardProperties';

/** Panel lateral de propiedades de la entidad seleccionada. */
export function SelectionPanel({
  selection,
  selectedEnemy,
  selectedHazard,
  selectedItem,
  duplicateSelected,
  deleteSelected,
  onEnemyChange,
  onHazardChange,
}: {
  selection: Selection;
  selectedEnemy: EnemySpawn | undefined;
  selectedHazard: HazardSpawn | undefined;
  selectedItem: ItemSpawn | undefined;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  onEnemyChange: (updated: EnemySpawn) => void;
  onHazardChange: (updated: HazardSpawn) => void;
}) {
  if (!selection) return null;
  return (
    <section className="editor-section editor-stack">
      <h2>Selección</h2>
      {selection.type !== 'start' && selection.type !== 'patrol' && (
        <div className="editor-field-row">
          <Button variant="secondary" onClick={duplicateSelected}>
            Duplicar
          </Button>
          <Button variant="secondary" className="editor-btn-danger" onClick={deleteSelected}>
            Borrar
          </Button>
        </div>
      )}
      {selection.type === 'start' && <p className="editor-hint">Inicio del jugador (arrástralo en el lienzo).</p>}
      {selection.type === 'patrol' && (
        <>
          <p className="editor-hint">Destino de patrulla (arrástralo en el lienzo).</p>
          <Button variant="secondary" className="editor-btn-danger" onClick={deleteSelected}>
            Quitar destino de patrulla
          </Button>
        </>
      )}

      {selectedEnemy && <EnemyProperties enemy={selectedEnemy} onChange={onEnemyChange} />}
      {selectedHazard && <HazardProperties hazard={selectedHazard} onChange={onHazardChange} />}
      {selectedItem && <p className="editor-hint">{selectedItem.kind} · arrástralo para moverlo.</p>}
    </section>
  );
}
