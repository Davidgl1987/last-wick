/**
 * Botón del kit: usa `Frame` por dentro (primario → marco ornate ámbar,
 * secundario → marco plain azulado) y añade tipografía/color/estados propios
 * (ver button.css). Puede renderizarse como `<a>` en vez de `<button>` pasando
 * `href` — lo necesita el botón "Editor" de la pantalla de título, que navega
 * por hash-routing en vez de disparar un handler.
 *
 * `ui-click` (encargo de audio): TODO botón del kit suena al pulsarse, tanto
 * en su forma `<button>` como `<a href>` — envuelve el `onClick` del
 * consumidor en vez de sustituirlo, así ningún botón existente pierde su
 * comportamiento por este cambio.
 */

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { playSfx } from '@/game/audio/sfxEngine';
import { frameClass, type FrameVariant } from './Frame';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'md' | 'lg';

interface ButtonOwnProps {
  variant: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

type ButtonAsButton = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps> & { href?: undefined };

type ButtonAsAnchor = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

const VARIANT_FRAME: Record<ButtonVariant, FrameVariant> = {
  primary: 'ornate',
  secondary: 'plain',
};

export function Button(props: ButtonProps) {
  const { variant, size = 'md', className = '', children, ...rest } = props;
  const cls = frameClass(VARIANT_FRAME[variant], `btn btn-${variant} btn-${size} ${className}`.trim());

  if (rest.href !== undefined) {
    const { href, onClick, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    const handleClick = (e: MouseEvent<HTMLAnchorElement>): void => {
      playSfx('ui-click');
      onClick?.(e);
    };
    return (
      <a className={cls} href={href} onClick={handleClick} {...anchorRest}>
        {children}
      </a>
    );
  }

  const { onClick, ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    playSfx('ui-click');
    onClick?.(e);
  };
  return (
    <button type="button" className={cls} onClick={handleClick} {...buttonRest}>
      {children}
    </button>
  );
}
