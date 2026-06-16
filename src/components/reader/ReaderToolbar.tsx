import type { ReadingSurface } from '../../types';
import { useReader } from '../../hooks/useReader';
import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './ReaderToolbar.module.css';

interface Props {
  chapter?: string;
  percentage: number;
  wordCount?: number;
}

const SURFACES: { key: ReadingSurface; bg: string; label: string }[] = [
  { key: 'light', bg: '#ffffff', label: 'Light page' },
  { key: 'sepia', bg: '#f0e6d3', label: 'Sepia page' },
  { key: 'dark', bg: '#2b2b2b', label: 'Dark page' },
];

export function ReaderToolbar({ chapter, percentage, wordCount }: Props) {
  const {
    currentBook,
    closeBook,
    showAnnotations,
    setShowAnnotations,
    theme,
    toggleTheme,
    readingSurface,
    setReadingSurface,
  } = useReader();
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
        <div className={styles.surfaces}>
          {SURFACES.map((s) => (
            <button
              key={s.key}
              className={`${styles.surfaceBtn} ${readingSurface === s.key ? styles.surfaceActive : ''}`}
              style={{ background: s.bg }}
              onClick={() => setReadingSurface(s.key)}
              title={s.label}
              aria-label={s.label}
            />
          ))}
        </div>
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
