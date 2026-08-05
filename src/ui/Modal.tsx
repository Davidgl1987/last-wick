/**
 * Modal del kit: backdrop a pantalla completa + panel enmarcado (Frame
 * variante `rich`, dorada). Cubre tanto el caso largo con scroll y pie fijo
 * (modal de pausa: mejoras + ajustes) como el corto (créditos): `actions` es
 * opcional y, cuando se pasa, queda FUERA del área de scroll (ver modal.css).
 *
 * `onClose` es opcional a propósito: varios modales del juego son elecciones
 * forzadas (fin de run, elegir recompensa de jefe) sin vía de escape — solo
 * cuando se pasa `onClose` el backdrop y Escape cierran el modal.
 *
 * Visibilidad por prop `open` en vez de por montaje condicional del padre:
 * para que exista animación de SALIDA el nodo tiene que seguir en el DOM
 * mientras dura, así que es este componente el que retrasa su propio
 * desmontaje hasta que la animación termina (`animationend`, con un
 * `setTimeout` de respaldo por si el evento no llega — por ejemplo si la
 * animación está anulada por `prefers-reduced-motion`).
 */

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Frame } from './Frame';
import './modal.css';

/** Margen sobre --ui-dur-out (130ms) para el respaldo del desmontaje. */
const EXIT_FALLBACK_MS = 400;

interface ModalProps {
  /** Visible u oculto. El desmontaje real se retrasa hasta que acaba la animación de salida. */
  open: boolean;
  title?: string;
  children: ReactNode;
  /** Pie fijo (botones), fuera del área de scroll. Omítelo si el modal no necesita acciones separadas. */
  actions?: ReactNode;
  /** Si se pasa, el backdrop y Escape cierran el modal. */
  onClose?: () => void;
  className?: string;
  /** Apunta a un id externo si el título visible no es el `h2` que renderiza este componente. */
  labelledBy?: string;
  'aria-label'?: string;
}

export function Modal({
  open,
  title,
  children,
  actions,
  onClose,
  className = '',
  labelledBy,
  'aria-label': ariaLabel,
}: ModalProps) {
  const titleId = useId();
  // `true` mientras el nodo deba estar en el DOM: se adelanta a `open` al
  // abrir y va por detrás al cerrar (lo que dura la animación de salida).
  const [mounted, setMounted] = useState(open);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    // Respaldo: si la animación de salida no dispara `animationend` (está
    // anulada, el nodo queda oculto, el navegador la descarta...), el modal
    // no puede quedarse colgado en pantalla.
    const timer = setTimeout(() => setMounted(false), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!onClose || !open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!mounted) return null;

  // Solo la animación del propio backdrop decide el desmontaje: las de sus
  // hijos (el panel) también burbujean hasta aquí.
  const handleAnimationEnd = (e: { target: EventTarget | null }) => {
    if (!open && e.target === backdropRef.current) setMounted(false);
  };

  // El título propio (h2) etiqueta el diálogo por defecto si no se pide otra cosa explícitamente.
  const usesOwnTitle = !labelledBy && !ariaLabel && title !== undefined;
  const resolvedLabelledBy = labelledBy ?? (usesOwnTitle ? titleId : undefined);

  // Evita que un clic dentro del panel burbujee al backdrop y lo cierre.
  // OJO: nunca pares aquí la propagación de teclado — el cierre con Escape
  // de arriba escucha en `window`, fuera del árbol de React de este nodo.
  const stopPropagation = (e: MouseEvent<HTMLElement>) => e.stopPropagation();

  return (
    <div
      ref={backdropRef}
      className={`modal-backdrop ${open ? 'modal-in' : 'modal-out'}`}
      onClick={onClose}
      onAnimationEnd={handleAnimationEnd}
    >
      <Frame
        as="div"
        variant="rich"
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={resolvedLabelledBy}
        onClick={stopPropagation}
      >
        <div className="modal-body">
          {title !== undefined && (
            <h2 className="modal-title" id={usesOwnTitle ? titleId : undefined}>
              {title}
            </h2>
          )}
          {children}
        </div>
        {actions && <div className="modal-actions">{actions}</div>}
      </Frame>
    </div>
  );
}
