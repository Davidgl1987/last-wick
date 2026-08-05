import type { EnemySpawn, HazardSpawn, ItemSpawn, RoomData } from '@/game/world/types';
import type { PlaceKind, Selection } from '@/editor/types';
import { Frame } from '@/ui';
import { RoomSection } from './RoomSection';
import { DoorsSection } from './DoorsSection';
import { EditorPalette } from './EditorPalette';
import { SelectionPanel } from './SelectionPanel';
import { FileSection } from './FileSection';
import { ValidationSection } from './ValidationSection';

/** Panel lateral: metadatos de sala, puertas, paleta de colocación, propiedades
 * de la selección, acciones de fichero y validación en vivo. */
export function EditorSidePanel({
  room,
  setRoom,
  placing,
  setPlacing,
  selection,
  selectedEnemy,
  selectedHazard,
  selectedItem,
  duplicateSelected,
  deleteSelected,
  onEnemyChange,
  onHazardChange,
  exportRoom,
  importRoom,
  saveToDevServer,
  fileInputRef,
  errors,
}: {
  room: RoomData;
  setRoom: (r: RoomData) => void;
  placing: PlaceKind;
  setPlacing: (p: PlaceKind) => void;
  selection: Selection;
  selectedEnemy: EnemySpawn | undefined;
  selectedHazard: HazardSpawn | undefined;
  selectedItem: ItemSpawn | undefined;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  onEnemyChange: (updated: EnemySpawn) => void;
  onHazardChange: (updated: HazardSpawn) => void;
  exportRoom: () => Promise<void>;
  importRoom: (file: File) => void;
  saveToDevServer: () => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  errors: string[];
}) {
  return (
    <Frame as="aside" variant="plain" className="editor-panel">
      <div className="editor-panel-body">
        <RoomSection room={room} setRoom={setRoom} />
        <DoorsSection room={room} setRoom={setRoom} />
        <EditorPalette placing={placing} setPlacing={setPlacing} />
        <SelectionPanel
          selection={selection}
          selectedEnemy={selectedEnemy}
          selectedHazard={selectedHazard}
          selectedItem={selectedItem}
          duplicateSelected={duplicateSelected}
          deleteSelected={deleteSelected}
          onEnemyChange={onEnemyChange}
          onHazardChange={onHazardChange}
        />
        <FileSection
          exportRoom={exportRoom}
          importRoom={importRoom}
          saveToDevServer={saveToDevServer}
          fileInputRef={fileInputRef}
        />
        <ValidationSection errors={errors} />
      </div>
    </Frame>
  );
}
