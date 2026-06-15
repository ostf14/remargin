import { forwardRef, useEffect, useRef, useState } from 'react';
import styles from './MarginNotes.module.css';

interface Props {
  top: number;
  note: string;
  autoFocus: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
  onBlurEmpty: () => void;
}

const TRUNCATE_AT = 180;

export const MarginNoteCard = forwardRef<HTMLDivElement, Props>(function MarginNoteCard(
  { top, note, autoFocus, onSave, onDelete, onBlurEmpty },
  ref,
) {
  const [editing, setEditing] = useState(autoFocus || note === '');
  const [draft, setDraft] = useState(note);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      const len = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(len, len);
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === note.trim()) {
      setEditing(false);
      if (trimmed === '') onBlurEmpty();
      return;
    }
    onSave(trimmed);
    setEditing(false);
    if (trimmed === '') onBlurEmpty();
  };

  const long = note.length > TRUNCATE_AT;
  const shown = !expanded && long ? `${note.slice(0, TRUNCATE_AT)}…` : note;

  return (
    <div ref={ref} className={styles.card} style={{ top }}>
      {editing ? (
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft(note);
              setEditing(false);
              if (note.trim() === '') onBlurEmpty();
            }
          }}
          placeholder="Write a note…"
          rows={2}
        />
      ) : (
        <>
          <div className={styles.noteText} onClick={() => setEditing(true)}>
            {shown}
            {long && (
              <button
                className={styles.showMore}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? 'show less' : 'show more'}
              </button>
            )}
          </div>
          <div className={styles.actions}>
            <button className={styles.actionBtn} title="Edit" onClick={() => setEditing(true)}>
              ✎
            </button>
            <button className={styles.actionBtn} title="Delete" onClick={onDelete}>
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
});
