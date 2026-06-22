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
} from 'lucide-react';
import type { ReadingSurface } from '../../types';
import { useReader } from '../../hooks/useReader';
import styles from './ReaderShell.module.css';

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
  subtitle?: string; // chapter (EPUB)
  progress: number; // 0–100 — percentage component of the bottom pill
  timeLeft?: string | null; // e.g. "4h 50m" — appears after a '|' divider, dropped when null
  pageText?: string; // "12 / 156" — appended after another '|' on desktop, hidden on mobile (the standalone .pageIndicator carries it there instead)
  onPrev: () => void;
  onNext: () => void;
  search?: SearchControls; // in-book find, always shown inline in the header
  font?: FontControls; // EPUB only
  children: ReactNode;
}

// Surface preview swatches for the settings dropdown.
const SURFACES: { key: ReadingSurface; bg: string }[] = [
  { key: 'light', bg: '#f5f0eb' },
  { key: 'sepia', bg: '#e8d5b8' },
  { key: 'dark', bg: '#2b2b2b' },
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
  timeLeft,
  pageText,
  onPrev,
  onNext,
  search,
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
  // DOM refs for the click-outside / escape closer below. settingsRef above tracks
  // the open boolean for the auto-hide timer; these point at the actual nodes so we
  // can decide whether a pointer event landed inside the drawer or on its toggle.
  const settingsDrawerRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
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

  // Mobile: block the system text-selection callout (Copy/Share OS menu) inside the reader
  // shell so our HighlightPopover is the only thing that appears on selection. Scoped to the
  // shell — long-press still opens a context menu in library cards. Tablet/desktop keep the
  // browser default.
  const shellRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 600px)').matches) return;
    const root = shellRootRef.current;
    if (!root) return;
    const blockContext = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // selectstart fires when a selection begins. Letting it bubble out lets browsers
    // (especially Chrome Android in a PWA) hand the gesture off to system handlers,
    // which then surface the Google search bubble. Stopping propagation keeps the
    // gesture inside our shell where HighlightPopover handles it.
    const blockSelectStart = (e: Event) => e.stopPropagation();
    root.addEventListener('contextmenu', blockContext);
    root.addEventListener('selectstart', blockSelectStart);
    return () => {
      root.removeEventListener('contextmenu', blockContext);
      root.removeEventListener('selectstart', blockSelectStart);
    };
  }, []);

  // Opening settings / search keeps the chrome up.
  useEffect(() => {
    if (settingsOpen) bump();
  }, [settingsOpen, bump]);

  // Click / tap anywhere outside the drawer (and not on its toggle) closes it.
  // Two subtleties handled here:
  //   1. Defer the listener by one tick — without the setTimeout, the click that
  //      OPENED the drawer can race the same listener (it bubbles to document after
  //      our state update commits, and we'd close immediately).
  //   2. Iframe isolation — the EPUB text lives in an iframe whose pointer events
  //      never bubble to the parent document. Attach the same handler to any
  //      iframe.contentDocument currently in the reader so taps on the text also
  //      dismiss the drawer. Using click/touchend so the handler runs after the
  //      iframe's own event pipeline has had its chance.
  const cleanupClickOutsideRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const timer = window.setTimeout(() => {
      const onPointerUp = (e: Event) => {
        const target = e.target as Node | null;
        if (!target) return;
        if (settingsDrawerRef.current?.contains(target)) return;
        if (settingsBtnRef.current?.contains(target)) return;
        setSettingsOpen(false);
      };
      document.addEventListener('click', onPointerUp);
      document.addEventListener('touchend', onPointerUp);
      const iframeDocs: Document[] = [];
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          const d = (f as HTMLIFrameElement).contentDocument;
          if (!d) return;
          d.addEventListener('click', onPointerUp);
          d.addEventListener('touchend', onPointerUp);
          iframeDocs.push(d);
        } catch {
          /* cross-origin iframe — skip */
        }
      });
      cleanupClickOutsideRef.current = () => {
        document.removeEventListener('click', onPointerUp);
        document.removeEventListener('touchend', onPointerUp);
        for (const d of iframeDocs) {
          try {
            d.removeEventListener('click', onPointerUp);
            d.removeEventListener('touchend', onPointerUp);
          } catch {
            /* doc may have gone away */
          }
        }
      };
    }, 10);
    return () => {
      window.clearTimeout(timer);
      cleanupClickOutsideRef.current?.();
      cleanupClickOutsideRef.current = null;
    };
  }, [settingsOpen]);

  // Escape closes the drawer too — mirrors how most native dropdowns behave.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

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
    <div ref={shellRootRef} className={`${styles.shell} ${show ? styles.showChrome : ''}`}>
      <div className={styles.content}>{children}</div>

      {/* Side page-turn zones (hidden while the notes panel is open). */}
      {!showAnnotations && (
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
            ref={settingsBtnRef}
            className={`${styles.iconBtn} ${settingsOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setSettingsOpen((o) => !o)}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>

          <div
            ref={settingsDrawerRef}
            className={`${styles.settings} ${settingsOpen ? styles.settingsOpen : ''}`}
          >
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
          </div>
        </div>
      </header>

      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>

      {/* Always-on progress pill, bottom-left — never auto-hides.
          Three segments, each wrapped in its own span for clear DOM structure:
          {percent} | {time-left} | {page-count}. The page segment is hidden on
          mobile (see .pillPageSegment in the @media block) and the page count
          shows up in the separate bottom-centre .pageIndicator instead. */}
      <div className={styles.progressPill}>
        <span>{Math.round(progress)}%</span>
        {timeLeft && (
          <>
            <span className={styles.divider} aria-hidden="true">|</span>
            <span>{timeLeft} left</span>
          </>
        )}
        {pageText && (
          <span className={styles.pillPageSegment}>
            <span className={styles.divider} aria-hidden="true">|</span>
            <span>{pageText}</span>
          </span>
        )}
      </div>

      {/* Section-local page indicator — sits between progress pill (left) and action pill
          (right) on the same baseline. epub.js's displayed.page/total are within the
          current spine section, not global, but reset on every page turn. */}
      {pageText && <div className={styles.pageIndicator}>{pageText}</div>}

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
