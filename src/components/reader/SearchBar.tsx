import { useEffect, useRef } from 'react';
import styles from './SearchBar.module.css';

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  current: number; // 1-based position of the active match, 0 when none
  total: number;
  searching?: boolean;
}

// Thin find-in-book strip under the toolbar. Reader-agnostic: it only renders the
// controls and reports intent; each reader owns the actual search + navigation.
export function SearchBar({
  query,
  onQueryChange,
  onPrev,
  onNext,
  onClose,
  current,
  total,
  searching,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const counter = searching
    ? 'Searching…'
    : total > 0
      ? `${current} of ${total}`
      : query
        ? 'No results'
        : '';

  return (
    <div className={styles.bar}>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder="Search in book..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className={styles.counter}>{counter}</span>
      <button
        className={styles.navBtn}
        onClick={onPrev}
        disabled={total === 0}
        title="Previous (Shift+Enter)"
      >
        ↑ Prev
      </button>
      <button
        className={styles.navBtn}
        onClick={onNext}
        disabled={total === 0}
        title="Next (Enter)"
      >
        ↓ Next
      </button>
      <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)" aria-label="Close">
        ×
      </button>
    </div>
  );
}
