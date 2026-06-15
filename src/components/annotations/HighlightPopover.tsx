import type { HighlightColor } from '../../types';
import styles from './HighlightPopover.module.css';

interface Props {
  x: number;
  y: number;
  onHighlight: (color: HighlightColor) => void;
  onDismiss: () => void;
}

const COLORS: { color: HighlightColor; cls: string }[] = [
  { color: 'yellow', cls: styles.yellow },
  { color: 'green', cls: styles.green },
  { color: 'blue', cls: styles.blue },
  { color: 'red', cls: styles.red },
  { color: 'purple', cls: styles.purple },
];

export function HighlightPopover({ x, y, onHighlight, onDismiss }: Props) {
  return (
    <>
      <div className={styles.backdrop} onClick={onDismiss} />
      <div className={styles.popover} style={{ left: x, top: y }}>
        {COLORS.map(({ color, cls }) => (
          <button
            key={color}
            className={`${styles.colorBtn} ${cls}`}
            onClick={() => onHighlight(color)}
            title={color}
          />
        ))}
      </div>
    </>
  );
}
