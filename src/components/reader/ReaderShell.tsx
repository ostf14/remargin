import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Search,
  PenTool,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  BookOpen,
  Scroll,
  FlipHorizontal,
} from 'lucide-react';
import type { ReadingSurface, ReaderMode } from '../../types';
import { useReader } from '../../hooks/useReader';
import styles from './ReaderShell.module.css';

interface ZoomControls {
  value: number; // 1 = 100%
  onIn: () => void;
  onOut: () => void;
}
interface FontControls {
  onInc: () => void;
  onDec: () => void;
}

interface Props {
  title: string;
  subtitle?: string;
  progress: number; // 0–100, drives the always-visible bottom bar
  progressText: string; // e.g. "4 / 18 · ~5h left"
  onPrev: () => void;
  onNext: () => void;
  onOpenSearch: () => void;
  zoom?: ZoomControls; // PDF only
  font?: FontControls; // EPUB only
  children: ReactNode;
}

// Surface preview swatches for the settings dropdown.
const SURFACES: { key: ReadingSurface; bg: string }[] = [
  { key: 'light', bg: '#f5f0eb' },
  { key: 'sepia', bg: '#e8d5b8' },
  { key: 'dark', bg: '#2b2b2b' },
];

const MODES: { key: ReaderMode; label: string; Icon: typeof BookOpen }[] = [
  { key: 'pages', label: 'Pages', Icon: BookOpen },
  { key: 'scroll', label: 'Scroll', Icon: Scroll },
  { key: 'flip', label: 'Flip', Icon: FlipHorizontal },
];

const HIDE_DELAY = 3000;
const HIDE_DELAY_SETTINGS = 6000;

// Immersive chrome around either reader: a 40px top bar, a settings dropdown, invisible
// side page-turn zones, and an always-visible 2px progress bar. Everything but the
// progress bar auto-hides after a few seconds of no pointer/keyboard activity.
export function ReaderShell({
  title,
  subtitle,
  progress,
  progressText,
  onPrev,
  onNext,
  onOpenSearch,
  zoom,
  font,
  children,
}: Props) {
  const {
    closeBook,
    showAnnotations,
    setShowAnnotations,
    theme,
    toggleTheme,
    readingSurface,
    setReadingSurface,
    readerMode,
    setReaderMode,
  } = useReader();
  const [show, setShow] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const settingsRef = useRef(settingsOpen);
  settingsRef.current = settingsOpen;

  // Reveal chrome and (re)arm the auto-hide timer on any activity.
  const bump = useCallback(() => {
    setShow(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => {
        setShow(false);
        setSettingsOpen(false);
      },
      settingsRef.current ? HIDE_DELAY_SETTINGS : HIDE_DELAY,
    );
  }, []);

  useEffect(() => {
    bump();
    const on = () => bump();
    // 'reader-activity' is dispatched from inside the EPUB iframe (whose own pointer
    // events don't bubble to the parent document).
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'reader-activity'];
    events.forEach((e) => window.addEventListener(e, on));
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, on));
    };
  }, [bump]);

  // Opening settings keeps chrome up and arms the longer timer. Guarded to fire only on
  // open, so the auto-hide (which also closes settings) can't immediately re-show chrome.
  useEffect(() => {
    if (settingsOpen) bump();
  }, [settingsOpen, bump]);

  return (
    <div className={`${styles.shell} ${show ? styles.showChrome : ''}`}>
      <div className={styles.content}>{children}</div>

      {/* Invisible side page-turn zones (hidden while the notes panel is open). */}
      {!showAnnotations && (
        <>
          <div className={styles.navLeft} onClick={onPrev} role="button" aria-label="Previous page">
            <ChevronLeft className={styles.chevron} size={22} />
          </div>
          <div className={styles.navRight} onClick={onNext} role="button" aria-label="Next page">
            <ChevronRight className={styles.chevron} size={22} />
          </div>
        </>
      )}

      <header className={styles.topBar}>
        <button className={styles.backBtn} onClick={closeBook}>
          <ArrowLeft size={12} />
          Library
        </button>

        <div className={styles.titleBlock}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>

        <div className={styles.topActions}>
          <button
            className={styles.iconBtn}
            onClick={onOpenSearch}
            title="Find in book (Ctrl+F)"
            aria-label="Find in book"
          >
            <Search size={16} />
          </button>
          <button
            className={`${styles.iconBtn} ${showAnnotations ? styles.iconBtnActive : ''}`}
            onClick={() => setShowAnnotations(!showAnnotations)}
            title="Annotations"
            aria-label="Toggle annotations"
          >
            <PenTool size={16} />
          </button>
          <button
            className={`${styles.iconBtn} ${settingsOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setSettingsOpen((o) => !o)}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>

          <div className={`${styles.settings} ${settingsOpen ? styles.settingsOpen : ''}`}>
            {zoom && (
              <div className={styles.row}>
                <span className={styles.label}>Zoom</span>
                <button className={styles.sBtn} onClick={zoom.onOut} aria-label="Zoom out">
                  &minus;
                </button>
                <span className={styles.sValue}>{Math.round(zoom.value * 100)}%</span>
                <button className={styles.sBtn} onClick={zoom.onIn} aria-label="Zoom in">
                  +
                </button>
              </div>
            )}
            {font && (
              <div className={styles.row}>
                <span className={styles.label}>Font</span>
                <button className={styles.sBtn} onClick={font.onDec} aria-label="Smaller text">
                  A&minus;
                </button>
                <button className={styles.sBtn} onClick={font.onInc} aria-label="Larger text">
                  A+
                </button>
              </div>
            )}
            <div className={styles.row}>
              <span className={styles.label}>Page</span>
              {SURFACES.map((s) => (
                <button
                  key={s.key}
                  className={`${styles.surfaceDot} ${readingSurface === s.key ? styles.surfaceActive : ''}`}
                  style={{ background: s.bg }}
                  onClick={() => setReadingSurface(s.key)}
                  aria-label={`${s.key} page`}
                />
              ))}
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Theme</span>
              <button
                className={`${styles.sBtn} ${theme === 'light' ? styles.sBtnActive : ''}`}
                onClick={() => {
                  if (theme !== 'light') toggleTheme();
                }}
                aria-label="Light theme"
              >
                <Sun size={12} />
              </button>
              <button
                className={`${styles.sBtn} ${theme === 'dark' ? styles.sBtnActive : ''}`}
                onClick={() => {
                  if (theme !== 'dark') toggleTheme();
                }}
                aria-label="Dark theme"
              >
                <Moon size={12} />
              </button>
            </div>
            <div className={styles.divider} />
            <div className={styles.row}>
              <span className={styles.label}>Mode</span>
              {MODES.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className={`${styles.modeBtn} ${readerMode === key ? styles.modeActive : ''}`}
                  onClick={() => setReaderMode(key)}
                >
                  <Icon size={10} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className={styles.bottomInfo}>{progressText}</div>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
    </div>
  );
}
