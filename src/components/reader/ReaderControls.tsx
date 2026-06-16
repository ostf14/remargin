import type { ReadingSurface } from '../../types';
import { useReader } from '../../hooks/useReader';
import styles from './ReaderControls.module.css';

const SURFACES: { key: ReadingSurface; bg: string; label: string }[] = [
  { key: 'light', bg: '#ffffff', label: 'Light page' },
  { key: 'sepia', bg: '#f0e6d3', label: 'Sepia page' },
  { key: 'dark', bg: '#2b2b2b', label: 'Dark page' },
];

// Bottom-right reader controls: page surface (light/sepia/dark) + app theme toggle.
export function ReaderControls() {
  const { theme, toggleTheme, readingSurface, setReadingSurface } = useReader();
  return (
    <div className={styles.controls}>
      <div className={styles.surfaces}>
        {SURFACES.map((s) => (
          <button
            key={s.key}
            className={`${styles.surfaceBtn} ${readingSurface === s.key ? styles.surfaceActive : ''}`}
            style={{ background: s.bg }}
            onClick={() => setReadingSurface(s.key)}
            title={s.label}
            aria-label={s.label}
          />
        ))}
      </div>
      <button
        className={styles.themeBtn}
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </div>
  );
}
