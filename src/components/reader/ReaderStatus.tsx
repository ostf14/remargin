import { readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './ReaderStatus.module.css';

// Bottom-left reading status: progress % and (when known) estimated time left.
// Recomputed from live progress, so the estimate counts down as you read.
export function ReaderStatus({
  wordCount,
  percentage,
}: {
  wordCount?: number;
  percentage: number;
}) {
  const remaining = wordCount ? readingMinutes(Math.max(0, wordCount * (1 - percentage / 100))) : 0;
  return (
    <div className={styles.status}>
      <span>{Math.round(percentage)}%</span>
      {remaining > 0 && (
        <>
          <span className={styles.sep}>·</span>
          <span>~{formatDuration(remaining)} left</span>
        </>
      )}
    </div>
  );
}
