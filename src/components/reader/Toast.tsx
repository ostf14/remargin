import { useRef } from 'react';
import styles from './Toast.module.css';

// Tiny transient toast pinned to the bottom of the reader. Always mounted so its
// opacity can transition both in and out; the last message is retained during
// fade-out so the text doesn't vanish mid-transition.
export function Toast({ message }: { message: string | null }) {
  const lastRef = useRef('');
  if (message) lastRef.current = message;

  return (
    <div
      className={`${styles.toast} ${message ? styles.visible : ''}`}
      role="status"
      aria-live="polite"
    >
      {message ?? lastRef.current}
    </div>
  );
}
