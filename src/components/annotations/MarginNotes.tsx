import { useLayoutEffect, useRef, useState } from 'react';
import type { HighlightColor } from '../../types';
import { MarginNoteCard } from './MarginNoteCard';
import styles from './MarginNotes.module.css';

export interface PositionedNote {
  id: string;
  anchorTop: number; // px from the top of the margin column, opposite the highlight
  note: string;
  color: HighlightColor;
}

interface Props {
  notes: PositionedNote[];
  autoFocusId: string | null;
  onSave: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onBlurEmpty: (id: string) => void;
}

const GAP = 8;
const CONNECTOR_X = 14; // where the connector meets the card

export function MarginNotes({ notes, autoFocusId, onSave, onDelete, onBlurEmpty }: Props) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [tops, setTops] = useState<Record<string, number>>({});

  const sorted = [...notes].sort((a, b) => a.anchorTop - b.anchorTop);

  // Stack cards downward so they never overlap: each card sits at its anchor,
  // or just below the previous card if that would overlap.
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    let prevBottom = -Infinity;
    for (const n of sorted) {
      const el = cardRefs.current.get(n.id);
      const h = el?.offsetHeight ?? 72;
      const top = Math.max(n.anchorTop, prevBottom + GAP);
      next[n.id] = top;
      prevBottom = top + h;
    }
    setTops((prev) => {
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.keys(next).every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });
  }, [sorted]);

  return (
    <div className={styles.column}>
      <svg className={styles.connectors} aria-hidden="true">
        {sorted.map((n) => {
          const cardTop = tops[n.id] ?? n.anchorTop;
          return (
            <polyline
              key={n.id}
              points={`0,${n.anchorTop} ${CONNECTOR_X / 2},${n.anchorTop} ${CONNECTOR_X},${cardTop + 16}`}
              className={styles.connectorLine}
            />
          );
        })}
      </svg>

      {sorted.map((n) => (
        <MarginNoteCard
          key={n.id}
          ref={(el) => {
            if (el) cardRefs.current.set(n.id, el);
            else cardRefs.current.delete(n.id);
          }}
          top={tops[n.id] ?? n.anchorTop}
          note={n.note}
          color={n.color}
          autoFocus={n.id === autoFocusId}
          onSave={(text) => onSave(n.id, text)}
          onDelete={() => onDelete(n.id)}
          onBlurEmpty={() => onBlurEmpty(n.id)}
        />
      ))}
    </div>
  );
}
