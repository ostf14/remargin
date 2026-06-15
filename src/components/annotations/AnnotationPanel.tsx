import type { Annotation, Book } from '../../types';
import { exportAnnotationsToMarkdown, downloadMarkdown } from '../../services/exportMarkdown';
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
  pink: 'var(--highlight-pink)',
};

export function AnnotationPanel({ annotations, book, onUpdate, onDelete }: Props) {
  const handleExport = () => {
    const md = exportAnnotationsToMarkdown(book, annotations);
    const filename = `${book.title.replace(/[^a-zA-Z0-9]/g, '_')}_annotations.md`;
    downloadMarkdown(md, filename);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Annotations</div>
          <div className={styles.count}>{annotations.length} highlights</div>
        </div>
        {annotations.length > 0 && (
          <button className={styles.exportBtn} onClick={handleExport}>
            Export MD
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
                  {a.chapter}
                </span>
                <button
                  className={styles.deleteBtn}
                  onClick={() => onDelete(a.id)}
                >
                  Remove
                </button>
              </div>
              <div className={styles.quote}>{a.text}</div>
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
