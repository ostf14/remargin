import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { HighlightColor } from '../../types';
import styles from './HighlightPopover.module.css';

interface Props {
  x: number;
  y: number;
  onHighlight: (color: HighlightColor) => void;
  onDismiss: () => void;
  onDelete?: () => void;
  onNote?: () => void;
  /** Mobile-only: persist the typed note text directly from the bottom sheet. */
  onSaveNote?: (text: string) => void;
  /** Mobile-only: copy a formatted citation; the parent decides what gets copied. */
  onCopyCitation?: () => void;
  noteLabel?: string;
  /** Pre-fill the textarea when editing an existing highlight's note. */
  initialNote?: string;
}

const COLORS: { color: HighlightColor; cls: string; hint: string }[] = [
  { color: 'yellow', cls: styles.yellow, hint: '1' },
  { color: 'green', cls: styles.green, hint: '2' },
  { color: 'blue', cls: styles.blue, hint: '3' },
  { color: 'red', cls: styles.red, hint: '4' },
  { color: 'purple', cls: styles.purple, hint: '5' },
];

// One popover, two layouts. Desktop: floats next to the selection (existing behaviour).
// Mobile (≤600px, CSS-only override): slides up as a bottom sheet — same buttons plus an
// inline note textarea and Copy citation, so the user can finish without the margin column.
export function HighlightPopover({
  x,
  y,
  onHighlight,
  onDismiss,
  onDelete,
  onNote,
  onSaveNote,
  onCopyCitation,
  noteLabel = 'Note',
  initialNote = '',
}: Props) {
  const isMobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches;
  const [noteMode, setNoteMode] = useState(false);
  const [noteText, setNoteText] = useState(initialNote);

  // Note button: on mobile, expand into the textarea; on desktop, the existing flow
  // (creates the highlight, opens the margin card) via onNote.
  const handleNote = () => {
    if (isMobile && onSaveNote) {
      setNoteText(initialNote);
      setNoteMode(true);
    } else {
      onNote?.();
    }
  };

  const handleSave = () => {
    onSaveNote?.(noteText.trim());
    setNoteMode(false);
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onDismiss} />
      <div className={styles.popover} style={{ left: x, top: y }}>
        <div className={styles.colorsRow}>
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
        </div>

        {noteMode ? (
          <div className={styles.noteForm}>
            <textarea
              className={styles.noteInput}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Note…"
              autoFocus
              rows={3}
            />
            <div className={styles.formActions}>
              <button className={styles.actionBtn} onClick={() => setNoteMode(false)}>
                Cancel
              </button>
              <button className={`${styles.actionBtn} ${styles.actionPrimary}`} onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.actionsRow}>
            {onNote && (
              <button className={styles.noteBtn} onClick={handleNote} title={noteLabel}>
                <Pencil size={14} aria-hidden="true" />
                <span>{isMobile ? (initialNote.trim() ? 'Edit note' : 'Add note') : noteLabel}</span>
              </button>
            )}
            {onCopyCitation && (
              <button className={styles.citationBtn} onClick={() => { onCopyCitation(); onDismiss(); }}>
                Copy citation
              </button>
            )}
            {onDelete && (
              <button className={styles.deleteBtn} onClick={onDelete} title="Delete highlight" aria-label="Delete highlight">
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
