import { useState } from 'react';
import type { Book } from '../../types';
import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './BookCard.module.css';

interface Props {
  book: Book;
  featured?: boolean; // the big "Continue reading" hero card (first in the grid)
  enriching?: boolean;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  onUpdate: (book: Book) => void;
}

type Field = 'title' | 'author';

export function BookCard({ book, featured, enriching, onClick, onRemove, onUpdate }: Props) {
  const progress = Math.round(book.progress ?? 0);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');

  // Estimated reading time remaining, for the hero overlay ("22% · ~5h left").
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
      const updated: Book =
        editing === 'title' ? { ...book, title: value } : { ...book, author: value };
      onUpdate(updated);
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

  return (
    <div className={styles.card}>
      <div className={styles.coverWrap} onClick={onClick}>
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
          aria-label="Remove book"
        >
          ×
        </button>

        {!featured && progress > 0 && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        )}

        {!featured && book.wordCount ? (
          <span className={styles.timeBadge}>~{formatDuration(readingMinutes(book.wordCount))}</span>
        ) : null}

        {enriching && (
          <div className={styles.enriching}>
            <div className={styles.spinner} />
          </div>
        )}

        {featured && (
          <div className={styles.continueOverlay}>
            <div className={styles.continueLabel}>Continue reading</div>
            <div className={styles.continueTitle}>{book.title}</div>
            <div className={styles.continueAuthor}>{book.author}</div>
            <div className={styles.continueBar}>
              <div className={styles.continueFill} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.continueText}>
              {progress}%{timeLeft ? ` · ~${timeLeft} left` : ''}
            </div>
          </div>
        )}
      </div>

      {!featured && (
        <div className={styles.meta}>
          {editing === 'title' ? (
            <input
              className={styles.metaInput}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
            />
          ) : (
            <div
              className={styles.metaTitle}
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
            />
          ) : (
            <div
              className={styles.metaAuthor}
              title="Click to edit author"
              onClick={(e) => startEdit('author', e)}
            >
              {book.author}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
