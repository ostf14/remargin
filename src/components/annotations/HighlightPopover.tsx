import type { HighlightColor } from '../../types';
import styles from './HighlightPopover.module.css';

interface Props {
  x: number;
  y: number;
  onHighlight: (color: HighlightColor) => void;
  onDismiss: () => void;
  onDelete?: () => void;
  onNote?: () => void;
  noteLabel?: string;
}

const COLORS: { color: HighlightColor; cls: string }[] = [
  { color: 'yellow', cls: styles.yellow },
  { color: 'green', cls: styles.green },
  { color: 'blue', cls: styles.blue },
  { color: 'red', cls: styles.red },
  { color: 'purple', cls: styles.purple },
];

export function HighlightPopover({
  x,
  y,
  onHighlight,
  onDismiss,
  onDelete,
  onNote,
  noteLabel = 'Note',
}: Props) {
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
        {onNote && (
          <button className={styles.noteBtn} onClick={onNote} title={noteLabel}>
            ✎ {noteLabel}
          </button>
        )}
        {onDelete && (
          <button className={styles.deleteBtn} onClick={onDelete} title="Delete highlight">
            ✕
          </button>
        )}
      </div>
    </>
  );
}
