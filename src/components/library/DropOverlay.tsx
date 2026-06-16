import styles from './DropOverlay.module.css';

// Full-screen "drop files to import" affordance, shown while a file is dragged
// over the window. Purely visual — the actual drop is handled at the window level.
export function DropOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles.inner}>
        <div className={styles.icon}>📚</div>
        <div className={styles.text}>Drop to import</div>
      </div>
    </div>
  );
}
