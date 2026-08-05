/**
 * Botón del kit: usa `Frame` por dentro (primario → marco ornate ámbar,
 * secundario → marco plain azulado) y añade tipografía/color/estados propios
 * (ver button.css). Puede renderizarse como `<a>` en vez de `<button>` pasando
 * `href` — lo necesita el botón "Editor" de la pantalla de título, que navega
 * por hash-routing en vez de disparar un handler.
 */

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
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
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a className={cls} href={href} {...anchorRest}>
        {children}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type="button" className={cls} {...buttonRest}>
      {children}
    </button>
  );
}
