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
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onUpdate: (book: Book) => void;
}

type Field = 'title' | 'author';

export function BookCard({ book, view, featured, enriching, onClick, onRemove, onUpdate }: Props) {
  const progress = Math.round(book.progress ?? 0);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  // Track the specific URL that failed so a re-enriched cover gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = book.coverUrl && failedUrl !== book.coverUrl ? book.coverUrl : null;

  // Estimated reading time remaining, for the hero card's foot ("22% · ~5h left").
  const timeLeft = book.wordCount
    ? formatDuration(readingMinutes(book.wordCount * (1 - progress / 100)))
    : null;

  const startEdit = (field: Field, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(book[field]);
    setEditing(field);
  };

  const commit = () => {
    if (!editing) return;
    const value = draft.trim();
    if (value && value !== book[editing]) {
      onUpdate(editing === 'title' ? { ...book, title: value } : { ...book, author: value });
    }
    setEditing(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setEditing(null);
    }
  };

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
      <div className={styles.row} onClick={onClick} role="button" tabIndex={0}>
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
    <div className={styles.card} onClick={onClick} role="button" tabIndex={0}>
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
        {editing === 'title' ? (
          <input
            className={styles.metaInput}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className={styles.title}
            title="Click to edit title"
            onClick={(e) => startEdit('title', e)}
          >
            {book.title}
          </div>
        )}

        {editing === 'author' ? (
          <input
            className={styles.metaInput}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className={styles.author}
            title="Click to edit author"
            onClick={(e) => startEdit('author', e)}
          >
            {book.author}
          </div>
        )}

        <div className={styles.foot}>
          <span className={styles.tag}>{book.format}</span>
          {footProgress && <span className={styles.progress}>{footProgress}</span>}
        </div>
      </div>
    </div>
  );
}
