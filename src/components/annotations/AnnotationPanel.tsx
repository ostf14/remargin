import type { Annotation, Book } from '../../types';
import { exportSingleAnnotation, exportAllAnnotations } from '../../services/exportMarkdown';
import { NoteEditor } from './NoteEditor';
import styles from './AnnotationPanel.module.css';

interface Props {
  annotations: Annotation[];
  book: Book;
  onUpdate: (id: string, updates: Partial<Pick<Annotation, 'note' | 'color'>>) => void;
  onDelete: (id: string) => void;
  // Jump the reader to a highlight's CFI. Card-level click handler delegates to
  // this; EpubReader also closes the panel on mobile after navigating.
  onNavigate: (cfi: string) => void;
}

const COLOR_MAP: Record<string, string> = {
  yellow: 'var(--highlight-yellow)',
  green: 'var(--highlight-green)',
  blue: 'var(--highlight-blue)',
  red: 'var(--highlight-red)',
  purple: 'var(--highlight-purple)',
};

function anchorLabel(a: Annotation): string {
  if (a.anchor.kind === 'pdf') return `Page ${a.anchor.page}`;
  return a.anchor.page ? `Page ${a.anchor.page}` : '';
}

export function AnnotationPanel({ annotations, book, onUpdate, onDelete, onNavigate }: Props) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Annotations</div>
          <div className={styles.count}>{annotations.length} highlights</div>
        </div>
        {annotations.length > 0 && (
          <button
            className={styles.exportBtn}
            onClick={() => {
              void exportAllAnnotations(book, annotations);
            }}
          >
            Export All
          </button>
        )}
      </div>

      <div className={styles.list}>
        {annotations.length === 0 ? (
          <div className={styles.empty}>
            Select text in the book to create highlights
          </div>
        ) : (
          annotations.map((a) => (
            <div
              key={a.id}
              className={styles.item}
              onClick={() => {
                if (a.anchor.kind === 'epub') onNavigate(a.anchor.cfi);
              }}
              role="button"
              tabIndex={0}
            >
              <div className={styles.itemHeader}>
                <span className={styles.chapter}>
                  <span
                    className={styles.colorDot}
                    style={{ background: COLOR_MAP[a.color] }}
                  />
                  {anchorLabel(a)}
                </span>
                <div className={styles.itemActions}>
                  <button
                    className={styles.itemExportBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      exportSingleAnnotation(book, a);
                    }}
                    title="Export this annotation as .md"
                  >
                    Export
                  </button>
                  <button
                    className={styles.deleteBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(a.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className={styles.quote}>{a.highlightedText}</div>
              {/* NoteEditor lives inside the card but its clicks must NOT bubble
                  up to the card's navigate handler — otherwise focusing the
                  textarea or clicking inside it would jump the reader. */}
              <div onClick={(e) => e.stopPropagation()}>
                <NoteEditor
                  value={a.note}
                  onChange={(note) => onUpdate(a.id, { note })}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
