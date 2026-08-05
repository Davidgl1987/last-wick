import { Button } from '@/ui';

/** Acciones de fichero: exportar/importar y (en dev) guardar en src/game/features/dungeon/levels. */
export function FileSection({
  exportRoom,
  importRoom,
  saveToDevServer,
  fileInputRef,
}: {
  exportRoom: () => Promise<void>;
  importRoom: (file: File) => void;
  saveToDevServer: () => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="editor-section editor-stack">
      <h2>Archivo</h2>
      <div className="editor-field-row">
        <Button variant="secondary" onClick={() => void exportRoom()}>
          Exportar
        </Button>
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          Importar
        </Button>
      </div>
      {import.meta.env.DEV && (
        <Button variant="secondary" className="editor-btn-save" onClick={() => void saveToDevServer()}>
          Guardar en src/game/features/dungeon/levels (dev)
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importRoom(file);
          e.target.value = '';
        }}
      />
    </section>
  );
}
