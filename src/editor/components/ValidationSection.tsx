import { Icon } from '@/ui';

/** Lista de errores de validación en vivo (o el "sala válida" cuando no hay ninguno). */
export function ValidationSection({ errors }: { errors: string[] }) {
  return (
    <section className="editor-section">
      <h2>Validación</h2>
      {errors.length === 0 ? (
        <p className="editor-valid">
          <Icon name="check" size={14} /> Sala válida
        </p>
      ) : (
        <ul className="editor-errors">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
