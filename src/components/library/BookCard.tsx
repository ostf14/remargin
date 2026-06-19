import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { Book } from '../../types';
import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './BookCard.module.css';

interface Props {
  book: Book;
  featured?: boolean; // the "Continue reading" book: accent strip on the card
  enriching?: boolean;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, book: Book) => void;
}

export function BookCard({ book, featured, enriching, onClick, onRemove, onContextMenu }: Props) {
  const progress = Math.round(book.progress ?? 0);
  // Track the specific URL that failed so a re-enriched cover gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = book.coverUrl && failedUrl !== book.coverUrl ? book.coverUrl : null;

  // Estimated reading time remaining, for the foot ("22% · ~5h left").
  const timeLeft = book.wordCount
    ? formatDuration(readingMinutes(book.wordCount * (1 - progress / 100)))
    : null;

  // Progress + time-left on any started/opened book (not just the continue card).
  const footProgress =
    book.lastOpened || progress > 0
      ? `${progress}%${timeLeft ? ` · ~${timeLeft} left` : ''}`
      : '';

  return (
    <div
      className={featured ? `${styles.card} ${styles.featuredCard}` : styles.card}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu?.(e, book)}
      role="button"
      tabIndex={0}
    >
      <div className={styles.coverZone}>
        {featured && <span className={styles.continueBadge}>Continue</span>}
        {cover ? (
          <img
            className={styles.cover}
            src={cover}
            alt={book.title}
            onError={() => setFailedUrl(book.coverUrl)}
          />
        ) : (
          <div className={styles.placeholder}>
            <BookOpen className={styles.placeholderIcon} size={28} aria-hidden="true" />
          </div>
        )}
        {enriching && (
          <div className={styles.enriching}>
            <div className={styles.spinner} />
          </div>
        )}
      </div>
      {/* Remove button is a direct child of the card so it can sit at the card's true
          top-right corner — on mobile the cover-zone only occupies a 4/3 strip at the
          top, and the X anchored to coverZone looked detached. */}
      <button
        className={styles.removeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(e);
        }}
        title="Remove"
        aria-label="Remove book"
      >
        <X size={14} />
      </button>

      <div className={styles.meta}>
        <div className={styles.title}>{book.title}</div>
        <div className={styles.author}>{book.author}</div>
        <div className={styles.foot}>
          <span className={styles.tag}>{book.format}</span>
          {footProgress && <span className={styles.progress}>{footProgress}</span>}
        </div>
      </div>
    </div>
  );
}
