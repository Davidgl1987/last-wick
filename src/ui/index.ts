/**
 * Kit de componentes de UI reutilizable (marco Kenney, tipografías y colores
 * de `src/styles/base.css`): lo consume tanto `src/game/ui/` como
 * `src/editor/` (`TextField`/`Select` nacieron para este último: son los
 * únicos controles nativos — texto/número y desplegable — que el editor
 * necesitaba y el kit todavía no cubría). Reexporta todo para un único
 * import (`import { Button, Modal, ... } from '@/ui'`).
 */

export { Frame, frameClass } from './Frame';
export type { FrameProps, FrameVariant } from './Frame';

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { Slider } from './Slider';

export { Checkbox } from './Checkbox';

export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { Select } from './Select';
export type { SelectProps } from './Select';

export { Modal } from './Modal';

export { Divider } from './Divider';

export { Icon } from './Icon';
export type { IconName } from './Icon';
