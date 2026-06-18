import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { Book, LibraryView } from '../../types';
import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './BookCard.module.css';

interface Props {
  book: Book;
  view: LibraryView;
  featured?: boolean; // the "Continue reading" book (grid only): Continue badge + time-left
  enriching?: boolean;
  className?: string; // extra grid class (e.g. the featured span) from the parent grid
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
}

export function BookCard({ book, view, featured, enriching, className, onClick, onRemove }: Props) {
  const progress = Math.round(book.progress ?? 0);
  // Track the specific URL that failed so a re-enriched cover gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = book.coverUrl && failedUrl !== book.coverUrl ? book.coverUrl : null;

  // Estimated reading time remaining, for the hero card's foot ("22% · ~5h left").
  const timeLeft = book.wordCount
    ? formatDuration(readingMinutes(book.wordCount * (1 - progress / 100)))
    : null;

  const removeBtn = (
    <button
      className={view === 'list' ? styles.rowRemove : styles.removeBtn}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(e);
      }}
      title="Remove"
      aria-label="Remove book"
    >
      <X size={14} />
    </button>
  );

  // ─────────────────────────── List view (variant C) ───────────────────────────
  if (view === 'list') {
    return (
      <div
        className={className ? `${styles.row} ${className}` : styles.row}
        onClick={onClick}
        role="button"
        tabIndex={0}
      >
        <div className={styles.thumb}>
          {cover ? (
            <img
              className={styles.thumbImg}
              src={cover}
              alt={book.title}
              onError={() => setFailedUrl(book.coverUrl)}
            />
          ) : (
            <BookOpen className={styles.thumbIcon} size={16} aria-hidden="true" />
          )}
        </div>
        <div className={styles.info}>
          <div className={styles.rowTitle}>{book.title}</div>
          <div className={styles.sub}>{book.author}</div>
        </div>
        <div className={styles.rowBar}>
          <div className={styles.rowBarFill} style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.format}>{book.format}</span>
        {removeBtn}
      </div>
    );
  }

  // ─────────────────── Grid view (Notion-style card, layout A) ───────────────────
  const footProgress = featured
    ? `${progress}%${timeLeft ? ` · ~${timeLeft} left` : ''}`
    : progress > 0
      ? `${progress}%`
      : '';

  return (
    <div
      className={className ? `${styles.card} ${className}` : styles.card}
      onClick={onClick}
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
        {removeBtn}
        {enriching && (
          <div className={styles.enriching}>
            <div className={styles.spinner} />
          </div>
        )}
      </div>

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
