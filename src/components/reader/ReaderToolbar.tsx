import { useReader } from '../../hooks/useReader';
import styles from './ReaderToolbar.module.css';

interface Props {
  chapter?: string;
  percentage: number;
}

export function ReaderToolbar({ chapter, percentage }: Props) {
  const { currentBook, closeBook, showAnnotations, setShowAnnotations, theme, toggleTheme } =
    useReader();
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
        <span className={styles.progress}>{Math.round(percentage)}%</span>
        <button
          className={styles.iconBtn}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
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
