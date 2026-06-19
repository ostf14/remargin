import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Search,
  PenTool,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
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
interface SearchControls {
  query: string;
  onQueryChange: (v: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  current: number; // 1-based active match, 0 when none
  total: number;
  searching: boolean;
}

interface Props {
  title: string;
  subtitle?: string; // chapter (EPUB) / "Page n / total" (PDF) — no progress
  progress: number; // 0–100
  progressText: string; // "22% · ~4h 50m left" — shown in the always-on bottom pill
  onPrev: () => void;
  onNext: () => void;
  search?: SearchControls; // in-book find, always shown inline in the header
  zoom?: ZoomControls; // PDF only
  font?: FontControls; // EPUB only
  showNav?: boolean; // page-turn side zones; false in EPUB scroll mode
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

// Immersive chrome around either reader: a 48px top bar (title + chapter/page line, an
// inline find field that slots in before the always-present action icons, and a settings
// dropdown), always-visible side page-turn chevrons, a thin progress strip, and an
// always-on progress pill in the bottom-left. The bar + strip auto-hide after a few
// seconds of inactivity (kept up while search/settings are open). Page-turning — nav-zone
// clicks/hover and the arrow keys — never summons the chrome.
export function ReaderShell({
  title,
  subtitle,
  progress,
  progressText,
  onPrev,
  onNext,
  search,
  zoom,
  font,
  showNav = true,
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
  // Mobile / tablet: the search input collapses behind a magnifying-glass icon. Desktop
  // (≥1025px) ignores this flag — CSS keeps the input visible regardless.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const settingsRef = useRef(settingsOpen);
  settingsRef.current = settingsOpen;
  const searchActive = !!search?.query; // a non-empty query keeps the chrome up
  const searchRef = useRef(searchActive);
  searchRef.current = searchActive;

  // Reveal chrome and (re)arm the auto-hide timer on any activity.
  const bump = useCallback(() => {
    setShow(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => {
        if (searchRef.current) return; // keep chrome up while search is open
        setShow(false);
        setSettingsOpen(false);
      },
      settingsRef.current ? HIDE_DELAY_SETTINGS : HIDE_DELAY,
    );
  }, []);

  useEffect(() => {
    bump();
    const on = (e: Event) => {
      // Page-turning must not summon the chrome: ignore clicks/moves over a nav zone and
      // the arrow keys (which turn the page).
      const t = e.target as Element | null;
      if (t?.closest?.('[data-nav-zone]')) return;
      if (e instanceof KeyboardEvent && e.key.startsWith('Arrow')) return;
      bump();
    };
    // 'reader-activity' is dispatched from inside the EPUB iframe (whose own pointer
    // events don't bubble to the parent document).
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'reader-activity'];
    events.forEach((e) => window.addEventListener(e, on));
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, on));
    };
  }, [bump]);

  // Opening settings / search keeps the chrome up.
  useEffect(() => {
    if (settingsOpen) bump();
  }, [settingsOpen, bump]);

  useEffect(() => {
    if (searchActive) bump();
  }, [searchActive, bump]);

  // Auto-open + focus the input when search is triggered from outside (e.g. notes-view
  // jump); collapse when cleared.
  useEffect(() => {
    if (searchActive) {
      setSearchOpen(true);
      // Wait for the input to become visible before focusing.
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setSearchOpen(false);
    }
  }, [searchActive]);

  // Just the position when there are hits; empty otherwise (no "No results"/"Searching").
  const searchCounter = search && search.total > 0 ? `${search.current} of ${search.total}` : '';

  return (
    <div className={`${styles.shell} ${show ? styles.showChrome : ''}`}>
      <div className={styles.content}>{children}</div>

      {/* Side page-turn zones (hidden while the notes panel is open, or in scroll mode). */}
      {showNav && !showAnnotations && (
        <>
          <div
            className={styles.navLeft}
            data-nav-zone
            onClick={onPrev}
            role="button"
            aria-label="Previous page"
          >
            <ChevronLeft className={styles.chevron} size={24} />
          </div>
          <div
            className={styles.navRight}
            data-nav-zone
            onClick={onNext}
            role="button"
            aria-label="Next page"
          >
            <ChevronRight className={styles.chevron} size={24} />
          </div>
        </>
      )}

      <header className={`${styles.topBar} ${searchOpen ? styles.mobileSearchOpen : ''}`}>
        <button className={styles.backBtn} onClick={closeBook} aria-label="Back to library">
          <ArrowLeft size={16} />
        </button>

        <div className={styles.titleBlock}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>

        {/* Magnifying-glass toggle — visible at ≤1024px only (CSS-gated). Expands the
            inline search field when tapped. */}
        {search && (
          <button
            className={styles.searchToggle}
            onClick={() => {
              setSearchOpen(true);
              window.setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
            title="Search"
            aria-label="Open search"
          >
            <Search size={18} />
          </button>
        )}

        {/* Find field — always visible on desktop; on ≤1024px stays collapsed until the
            toggle is tapped (the topBar's .mobileSearchOpen class flips its display). */}
        {search && (
          <div className={styles.headerSearch}>
            <Search className={styles.headerSearchIcon} size={12} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className={styles.headerSearchInput}
              type="text"
              placeholder="Search"
              value={search.query}
              onChange={(e) => search.onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) search.onPrev();
                  else search.onNext();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  search.onClose();
                  setSearchOpen(false);
                }
              }}
            />
            {search.total > 0 && (
              <>
                <span className={styles.searchCounter}>{searchCounter}</span>
                <button className={styles.searchBtn} onClick={search.onPrev} aria-label="Previous match">
                  <ChevronUp size={14} />
                </button>
                <button className={styles.searchBtn} onClick={search.onNext} aria-label="Next match">
                  <ChevronDown size={14} />
                </button>
              </>
            )}
            {(search.query || searchOpen) && (
              <button
                className={styles.searchBtn}
                onClick={() => {
                  search.onClose();
                  setSearchOpen(false);
                }}
                aria-label={search.query ? 'Clear search' : 'Close search'}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className={styles.topActions}>
          <button
            className={`${styles.iconBtn} ${styles.annotationsBtn} ${showAnnotations ? styles.iconBtnActive : ''}`}
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

      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>

      {/* Always-on progress pill (bottom-left), like a word count — never auto-hides. */}
      {progressText && <div className={styles.progressPill}>{progressText}</div>}

      {/* Mobile-only bottom-right action pill — replaces the search toggle + annotations
          icon in the header to keep the small header uncluttered. Hidden on desktop. */}
      <div className={styles.actionPill}>
        {search && (
          <button
            className={styles.pillBtn}
            onClick={() => {
              setSearchOpen(true);
              window.setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
            title="Search"
            aria-label="Open search"
          >
            <Search size={20} />
          </button>
        )}
        <button
          className={`${styles.pillBtn} ${showAnnotations ? styles.pillBtnActive : ''}`}
          onClick={() => setShowAnnotations(!showAnnotations)}
          title="Annotations"
          aria-label="Toggle annotations"
        >
          <PenTool size={20} />
        </button>
      </div>
    </div>
  );
}
