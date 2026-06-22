import type { Annotation, Book } from '../../types';
import { exportSingleAnnotation, exportAllAnnotations } from '../../services/exportMarkdown';
import { NoteEditor } from './NoteEditor';
import styles from './AnnotationPanel.module.css';

interface Props {
  annotations: Annotation[];
  book: Book;
  onUpdate: (id: string, updates: Partial<Pick<Annotation, 'note' | 'color'>>) => void;
  onDelete: (id: string) => void;
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

export function AnnotationPanel({ annotations, book, onUpdate, onDelete }: Props) {
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
            <div key={a.id} className={styles.item}>
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
                    onClick={() => exportSingleAnnotation(book, a)}
                    title="Export this annotation as .md"
                  >
                    Export
                  </button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => onDelete(a.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className={styles.quote}>{a.highlightedText}</div>
              <NoteEditor
                value={a.note}
                onChange={(note) => onUpdate(a.id, { note })}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
