import type { Book } from '../../types';
import styles from './BookCard.module.css';

interface Props {
  book: Book;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
}

export function BookCard({ book, onClick, onRemove }: Props) {
  const progress = book.progress ?? 0;

  return (
    <div className={styles.card} onClick={onClick}>
      {book.coverUrl ? (
        <img className={styles.cover} src={book.coverUrl} alt={book.title} />
      ) : (
        <div className={styles.placeholder}>
          <span className={styles.placeholderIcon}>
            {book.format === 'epub' ? '📖' : '📄'}
          </span>
          <span className={styles.placeholderTitle}>{book.title}</span>
        </div>
      )}

      <span className={styles.badge}>{book.format}</span>

      <button
        className={styles.removeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(e);
        }}
        title="Remove"
      >
        ×
      </button>

      <div className={styles.overlay}>
        <div className={styles.title}>{book.title}</div>
        <div className={styles.author}>{book.author}</div>
      </div>

      {progress > 0 && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
