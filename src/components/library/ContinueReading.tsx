import type { Book } from '../../types';
import styles from './ContinueReading.module.css';

interface Props {
  book: Book;
  onContinue: () => void;
}

// The hero "resume" card above the grid — your last book, lying open on the desk.
export function ContinueReading({ book, onContinue }: Props) {
  const progress = Math.round(book.progress ?? 0);

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onContinue}
      aria-label={`Continue reading ${book.title}`}
    >
      <div className={styles.coverWrap}>
        {book.coverUrl ? (
          <img className={styles.cover} src={book.coverUrl} alt="" />
        ) : (
          <div className={styles.coverPlaceholder}>{book.format === 'epub' ? '📖' : '📄'}</div>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.eyebrow}>Continue reading</div>
        <div className={styles.title}>{book.title}</div>
        <div className={styles.author}>{book.author}</div>
        <div className={styles.progressRow}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.progressPct}>{progress}%</span>
        </div>
      </div>

      <span className={styles.cta}>Continue →</span>
    </button>
  );
}
