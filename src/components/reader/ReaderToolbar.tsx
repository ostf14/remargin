import { useReader } from '../../hooks/useReader';
import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './ReaderToolbar.module.css';

interface Props {
  chapter?: string;
  percentage: number;
  wordCount?: number;
}

export function ReaderToolbar({ chapter, percentage, wordCount }: Props) {
  const { currentBook, closeBook, showAnnotations, setShowAnnotations, theme, toggleTheme } =
    useReader();
  if (!currentBook) return null;

  const remainingMin = wordCount
    ? readingMinutes(Math.max(0, wordCount * (1 - percentage / 100)))
    : 0;

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
        {remainingMin > 0 && (
          <span className={styles.timeLeft}>~{formatDuration(remainingMin)} left</span>
        )}
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
