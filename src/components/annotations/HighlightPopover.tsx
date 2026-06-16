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

const COLORS: { color: HighlightColor; cls: string; hint: string }[] = [
  { color: 'yellow', cls: styles.yellow, hint: '1' },
  { color: 'green', cls: styles.green, hint: '2' },
  { color: 'blue', cls: styles.blue, hint: '3' },
  { color: 'red', cls: styles.red, hint: '4' },
  { color: 'purple', cls: styles.purple, hint: '5' },
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
        {COLORS.map(({ color, cls, hint }) => (
          <button
            key={color}
            className={`${styles.colorBtn} ${cls}`}
            onClick={() => onHighlight(color)}
            title={color}
          >
            <span className={styles.keyHint}>{hint}</span>
          </button>
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
