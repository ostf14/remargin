import type { ReadingSurface } from '../../types';
import { useReader } from '../../hooks/useReader';
import styles from './ReaderToolbar.module.css';

interface Props {
  chapter?: string;
  percentage: number;
  onOpenSearch?: () => void;
}

const SURFACES: { key: ReadingSurface; bg: string; label: string }[] = [
  { key: 'light', bg: '#ffffff', label: 'Light page' },
  { key: 'sepia', bg: '#f0e6d3', label: 'Sepia page' },
  { key: 'dark', bg: '#2b2b2b', label: 'Dark page' },
];

export function ReaderToolbar({ chapter, percentage, onOpenSearch }: Props) {
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
