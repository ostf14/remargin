import { useReader } from '../../hooks/useReader';
import styles from './ReaderToolbar.module.css';

interface Props {
  chapter?: string;
  onOpenSearch?: () => void;
}

export function ReaderToolbar({ chapter, onOpenSearch }: Props) {
  const { currentBook, closeBook, showAnnotations, setShowAnnotations } = useReader();
  if (!currentBook) return null;

  return (
    <div className={styles.toolbar}>
      <button className={styles.backBtn} onClick={closeBook}>
        <span className={styles.arrow}>&larr;</span>
        Library
      </button>

      <div className={styles.info}>
        <div className={styles.bookTitle}>{currentBook.title}</div>
        {chapter && <div className={styles.chapter}>{chapter}</div>}
      </div>

      <div className={styles.right}>
        {onOpenSearch && (
          <button
            className={styles.iconBtn}
            onClick={onOpenSearch}
            title="Find in book (Ctrl+F)"
            aria-label="Find in book"
          >
            ⌕
          </button>
        )}
        <button
          className={showAnnotations ? styles.iconBtnActive : styles.iconBtn}
          onClick={() => setShowAnnotations(!showAnnotations)}
          title="Annotations"
        >
          &#9998;
        </button>
      </div>
    </div>
  );
}
