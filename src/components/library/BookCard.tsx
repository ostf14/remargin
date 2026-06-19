import { useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { Book } from '../../types';
import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './BookCard.module.css';

interface Props {
  book: Book;
  featured?: boolean; // the "Continue reading" book: accent strip on the card
  enriching?: boolean;
  onClick: () => void;
  onContextMenu?: (e: { clientX: number; clientY: number; preventDefault: () => void }, book: Book) => void;
}

const LONG_PRESS_MS = 500;
const TOUCH_MOVE_TOLERANCE = 10; // px; jitter past this cancels the long-press timer

export function BookCard({ book, featured, enriching, onClick, onContextMenu }: Props) {
  const progress = Math.round(book.progress ?? 0);
  // Track the specific URL that failed so a re-enriched cover gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = book.coverUrl && failedUrl !== book.coverUrl ? book.coverUrl : null;

  // Long-press state. fired = a context menu opened on this touch; suppresses the
  // synthesized click that follows touchend so the book doesn't also open.
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);

  // Estimated reading time remaining, for the foot ("22% · ~5h left").
  const timeLeft = book.wordCount
    ? formatDuration(readingMinutes(book.wordCount * (1 - progress / 100)))
    : null;

  // Progress + time-left on any started/opened book (not just the continue card).
  const footProgress =
    book.lastOpened || progress > 0
      ? `${progress}%${timeLeft ? ` · ~${timeLeft} left` : ''}`
      : '';

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!onContextMenu) return;
    const t = e.touches[0];
    if (!t) return;
    longPressFiredRef.current = false;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      const start = touchStartRef.current;
      if (!start) return;
      longPressFiredRef.current = true;
      onContextMenu({ clientX: start.x, clientY: start.y, preventDefault: () => {} }, book);
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    const t = e.touches[0];
    if (!start || !t) return;
    if (
      Math.abs(t.clientX - start.x) > TOUCH_MOVE_TOLERANCE ||
      Math.abs(t.clientY - start.y) > TOUCH_MOVE_TOLERANCE
    ) {
      clearLongPress();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    clearLongPress();
    if (longPressFiredRef.current) {
      // The context menu opened on long-press — block the synthesized click that
      // would otherwise also open the book.
      e.preventDefault();
    }
  };

  const handleClick = () => {
    // Synthesized clicks after a long-press were preventDefault'd on touchend, but
    // belt-and-braces: if the flag is still set, ignore this click too.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onClick();
  };

  return (
    <div
      className={featured ? `${styles.card} ${styles.featuredCard}` : styles.card}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu?.(e, book)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={clearLongPress}
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
