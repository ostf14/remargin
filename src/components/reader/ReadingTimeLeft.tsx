import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './ReadingTimeLeft.module.css';

// Estimated time left, pinned to the reader's bottom-left corner. Recomputed from
// live progress, so it counts down as you read. Hidden until the word count exists.
export function ReadingTimeLeft({
  wordCount,
  percentage,
}: {
  wordCount?: number;
  percentage: number;
}) {
  if (!wordCount) return null;
  const remaining = readingMinutes(Math.max(0, wordCount * (1 - percentage / 100)));
  if (remaining <= 0) return null;
  return <div className={styles.timeLeft}>~{formatDuration(remaining)} left</div>;
}
