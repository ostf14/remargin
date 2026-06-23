import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import ePub, { type Rendition, type Book as EpubBook } from 'epubjs';
import type { Annotation, Book, EpubAnchor, HighlightColor, ReadingSurface } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
import { usePinchZoom } from '../../hooks/usePinchZoom';
import { getBookFile, loadAppState, saveAppState } from '../../services/storage';
import { ReaderShell } from './ReaderShell';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { MarginNotes, type PositionedNote } from '../annotations/MarginNotes';
import { Toast } from './Toast';
import { formatCitation } from '../../services/citation';
import { countEpubWords, readingMinutes, formatDuration } from '../../services/wordCount';
import styles from './EpubReader.module.css';

interface EpubSearchMatch {
  cfi: string;
  excerpt: string;
}

interface Props {
  book: Book;
}

// Font size offset, in % points off the 100% base (SPEC §4.3 accessibility).
const FONT_MIN = -20; // 80%
const FONT_MAX = 50; // 150%
const FONT_STEP = 5;
const clampFontOffset = (o: number) => Math.max(FONT_MIN, Math.min(FONT_MAX, o));

// Visual zoom — a CSS transform on the whole page (SPEC §4.2), same as the PDF
// reader. Distinct from font size: zoom scales visually, A±/A− reflows the text.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

// Number-key → highlight colour (keyboard highlight, no popover).
const KEY_COLORS: Record<string, HighlightColor> = {
  '1': 'yellow',
  '2': 'green',
  '3': 'blue',
  '4': 'red',
  '5': 'purple',
};

// Reading-surface theme injected into the epub iframe. Background stays transparent
// so the .page (--reader-page, switched via [data-surface]) shows through; only the
// ink + link colours differ per surface. Full rule set per theme so select() is
// self-contained regardless of epub.js merge behaviour.
function surfaceInk(surface: ReadingSurface): string {
  return surface === 'sepia' ? '#5b4636' : surface === 'dark' ? '#d4d4d4' : '#313131';
}

function surfaceTheme(surface: ReadingSurface): Record<string, Record<string, string>> {
  const ink = surfaceInk(surface);
  const link = surface === 'dark' ? '#9b9bff' : '#8e5cd6';
  // On narrow viewports the textZone hugs the page edges (16/12px paddings) and the
  // bottom of the page sits right above the action pill — without extra room inside
  // the iframe itself the last paginated line nearly touches the page's bottom edge.
  // Give the iframe body 55px bottom pad on mobile so there's clear breathing space.
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
  return {
    body: {
      background: 'transparent !important',
      color: `${ink} !important`,
      'font-family': "'Newsreader', Georgia, serif !important",
      'line-height': '1.7 !important',
      padding: isMobile ? '0 0 55px 0 !important' : '0 !important',
      '-webkit-user-select': 'text !important',
      'user-select': 'text !important',
      // Block the Chrome Android long-press "Google search" callout while preserving
      // the user's ability to select text. CSS variables don't cross the iframe so we
      // inject literals here too.
      '-webkit-touch-callout': 'none !important',
      '-webkit-tap-highlight-color': 'transparent !important',
    },
    a: { color: `${link} !important` },
    // Keep media within the column/page so it can't get cropped or bleed onto the next page.
    'img, svg, video, canvas, figure': {
      'max-width': '100% !important',
      'max-height': '95vh !important',
      height: 'auto !important',
      'page-break-inside': 'avoid !important',
      'break-inside': 'avoid !important',
      display: 'block !important',
      margin: '0 auto !important',
      'object-fit': 'contain !important',
    },
    '::selection': { background: 'rgba(142, 92, 214, 0.3) !important' },
  };
}

// Text-zone top padding (CSS) — vertical offset of the iframe from the page top.
const EPUB_PAD_TOP = 40;

// Shared CFI utility for ordering annotation CFIs against the visible page's CFI
// window. epubjs attaches the EpubCFI class to its default export at runtime
// (lib/epub.js: `ePub.CFI = _epubcfi.default;`) but the d.ts doesn't surface it as
// a named export, so reach for the runtime property with a minimal cast.
const cfiTool = new (ePub as unknown as {
  CFI: new () => { compare: (a: string, b: string) => number };
}).CFI();

interface PopoverState {
  x: number;
  y: number;
  text: string;
  cfiRange: string;
  chapter: string;
  page?: number;
}

export function EpubReader({ book }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const pageElRef = useRef<HTMLDivElement>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { patchBook } = useLibrary();
  const { showAnnotations, readingSurface, pendingAnchor } = useReader();
  const readingSurfaceRef = useRef(readingSurface);
  readingSurfaceRef.current = readingSurface;
  // Opened from the Notes view targeting a highlight → start at its CFI instead of the
  // saved reading position. Captured once at mount (openBook resets pendingAnchor per open).
  const initialCfiRef = useRef(
    pendingAnchor?.kind === 'epub' ? pendingAnchor.cfi : book.lastPosition,
  );
  const lastCfiRef = useRef<string | null>(initialCfiRef.current);
  // A side EPUB instance (never rendered) that owns the generated locations index —
  // kept off the rendition's book so generating it can't disturb live rendering.
  const sideRef = useRef<EpubBook | null>(null);
  const { annotations, addAnnotation, updateAnnotation, deleteAnnotation } =
    useAnnotations(book.id);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [chapter, setChapter] = useState('');
  const [percentage, setPercentage] = useState(book.progress ?? 0);
  const [pageText, setPageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [wordCount, setWordCount] = useState(book.wordCount);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [savedPopover, setSavedPopover] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  const [notePositions, setNotePositions] = useState<PositionedNote[]>([]);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const autoFocusIdRef = useRef<string | null>(null);
  autoFocusIdRef.current = autoFocusId;
  const [relocateTick, setRelocateTick] = useState(0);
  const [fontOffset, setFontOffset] = useState(() => clampFontOffset(loadAppState().epubFontSizeOffset));
  const fontOffsetRef = useRef(fontOffset);
  fontOffsetRef.current = fontOffset;
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Transient "Copied citation" toast.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1500);
  }, []);
  // Keydown fires inside the epub iframe (forwarded via rendition.on('keydown')) and
  // on the outer document — both call the latest handler through this ref.
  const shortcutKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // In-book search — always visible in the header (no open/close toggle).
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchMatches, setSearchMatches] = useState<EpubSearchMatch[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const searchSeqRef = useRef(0);
  const searchCacheRef = useRef<{ query: string; matches: EpubSearchMatch[] } | null>(null);
  const searchHighlightRef = useRef<string | null>(null);
  // cfi of the last match the user navigated to. Used by the close-effect to
  // restore the exact position the user saw before clicking X — currentLocation
  // returns the top-of-viewport cfi in scrolled-doc, which after flow change to
  // paginated paginates from there and pushes the match a column or two down.
  const lastMatchCfiRef = useRef<string | null>(null);

  // Ctrl + wheel = continuous visual zoom (blocks the browser's own page zoom).
  const handleZoomWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z - e.deltaY * 0.002));
  }, []);

  // Swipe-to-turn-pages. Attached both to the .page wrapper (for taps that land on
  // its margins / chrome) and to each rendered iframe document (where the EPUB text
  // actually sits — touch events inside the iframe do not bubble to the parent).
  // Passive listeners so vertical scrolling stays smooth; the thresholds in onSwipeEnd
  // filter out scrolls, taps, and the long-press-then-drag that starts text selection.
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onSwipeStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t: Date.now(),
    };
  }, []);
  const onSwipeEnd = useCallback((e: TouchEvent) => {
    const s = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!s || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    const dt = Date.now() - s.t;
    // Need a decisive horizontal flick: ≥50px horizontal, more horizontal than
    // vertical (else it's a scroll), and under 500ms (else it's a long press).
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) || dt > 500) return;
    if (dx < 0) renditionRef.current?.next();
    else renditionRef.current?.prev();
  }, []);

  // Position margin notes opposite their highlight. Filter to the currently visible
  // page via TWO filters:
  //   1. CFI window — annotation.cfi must sit between currentLocation().start.cfi and
  //      .end.cfi. Cheap, cross-section accurate. But in paginated flow epub.js
  //      sometimes reports the same start/end CFIs for several consecutive column
  //      turns inside one section, so this alone leaks the same note onto every
  //      visual page of the section.
  //   2. iframe-viewport rect intersection — annotation's range.getBoundingClientRect
  //      is in the iframe document's viewport (a single column for paginated mode);
  //      ranges that live in off-screen columns sit at negative-x or x > iw and get
  //      dropped. This is the per-visual-page guard the CFI window can't give us.
  // Both together: cross-section bug-resistant AND one-note-per-visual-page.
  const recomputeNotePositions = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) {
      setNotePositions([]);
      return;
    }
    // Early calls fire before the rendition's manager is wired (between renderTo and
    // the first display() resolving), at which point epub.js's currentLocation() reads
    // a property on `undefined` and throws. Treat any failure as "no visible page yet"
    // and exit cleanly — the next relocated/font-change tick will retry.
    let loc:
      | { start?: { cfi: string }; end?: { cfi: string } }
      | undefined
      | null;
    try {
      loc = rendition.currentLocation() as typeof loc;
    } catch {
      setNotePositions([]);
      return;
    }
    const startCfi = loc?.start?.cfi;
    const endCfi = loc?.end?.cfi;
    if (!startCfi || !endCfi) {
      setNotePositions([]);
      return;
    }
    const iframe = viewerRef.current?.querySelector('iframe');
    const iw = iframe?.clientWidth ?? 0;
    const ih = iframe?.clientHeight ?? 0;
    const result: PositionedNote[] = [];
    for (const a of annotationsRef.current) {
      if (a.anchor.kind !== 'epub') continue;
      if (a.note.trim() === '' && a.id !== autoFocusIdRef.current) continue;
      try {
        if (cfiTool.compare(a.anchor.cfi, startCfi) < 0) continue;
        if (cfiTool.compare(a.anchor.cfi, endCfi) > 0) continue;
      } catch {
        continue;
      }
      let range: Range | null = null;
      try {
        range = rendition.getRange(a.anchor.cfi);
      } catch {
        range = null;
      }
      if (!range) continue;
      const r = range.getBoundingClientRect();
      if (!r) continue;
      // Viewport intersection: drop annotations whose range sits entirely in an
      // off-screen column of the current section. Only runs once iframe metrics
      // are known (iw/ih > 0) — early frames where the iframe hasn't laid out
      // yet skip the geometric guard rather than reject everything.
      if (iw > 0 && ih > 0) {
        if (r.right < 0 || r.left > iw || r.bottom < 0 || r.top > ih) continue;
      }
      result.push({ id: a.id, anchorTop: EPUB_PAD_TOP + r.top, note: a.note, color: a.color });
    }
    setNotePositions(result);
  }, []);

  const getCurrentChapter = useCallback(async (epub: EpubBook, href: string) => {
    const toc = epub.navigation?.toc || [];
    for (const item of toc) {
      if (href.includes(item.href.split('#')[0])) {
        return item.label.trim();
      }
    }
    return '';
  }, []);

  useEffect(() => {
    if (!viewerRef.current) return;
    const container = viewerRef.current;
    container.innerHTML = '';

    let cancelled = false;
    let epub: EpubBook | null = null;
    let rendition: Rendition | null = null;
    let handleKey: ((e: KeyboardEvent) => void) | null = null;

    (async () => {
      const arrayBuf = await getBookFile(book.id);
      if (cancelled || !arrayBuf) return;

      epub = ePub(arrayBuf);
      epubRef.current = epub;

      // On a *separate* (unrendered) copy of the book: count words for the reading-time
      // estimate AND build the global locations index for cross-section page numbering
      // and accurate progress. Doing either on the rendition's own book corrupts live
      // rendering and percentages, so we keep it apart. locations.generate is heavy
      // (1-3s on big books) — we persist its result to localStorage keyed by book.id
      // so subsequent opens load it instantly.
      (async () => {
        const buf = await getBookFile(book.id);
        if (!buf || cancelled) return;
        let side: EpubBook;
        try {
          side = ePub(buf.slice(0));
          await side.ready;
        } catch {
          return;
        }
        if (cancelled) {
          side.destroy();
          return;
        }
        if (book.wordCount === undefined) {
          try {
            const words = await countEpubWords(side);
            if (words > 0 && !cancelled) {
              setWordCount(words);
              patchBook(book.id, { wordCount: words });
            }
          } catch {
            /* leave wordCount undefined */
          }
        }
        const locKey = `remargin_locations_${book.id}`;
        const saved = (() => {
          try { return localStorage.getItem(locKey); } catch { return null; }
        })();
        const locs = side.locations as unknown as {
          load: (s: string) => unknown;
          save: () => string;
          generate: (chars: number) => Promise<string[]>;
          locationFromCfi: (cfi: string) => number;
          percentageFromCfi: (cfi: string) => number;
          total: number;
        };
        if (saved) {
          try { locs.load(saved); } catch { /* fall through to generate */ }
        }
        if (!locs.total) {
          try {
            await locs.generate(1024);
            try { localStorage.setItem(locKey, locs.save()); } catch { /* quota; live without persistence */ }
          } catch {
            /* progress falls back to epub.js' coarse percentage; page text falls back to section-local */
          }
        }
        if (cancelled) {
          side.destroy();
          return;
        }
        sideRef.current = side;
        // Locations are ready now — refresh percent + global page text against the
        // last known cfi so the bottom pill jumps from "..." (or section-local) to
        // the real global numbering without waiting for the next page turn.
        const cfi = lastCfiRef.current;
        if (cfi) {
          try {
            const p = locs.percentageFromCfi(cfi);
            if (Number.isFinite(p)) setPercentage(Math.max(0, Math.min(100, Math.round(p * 100))));
          } catch { /* skip */ }
          if (locs.total > 0) {
            try {
              const idx = locs.locationFromCfi(cfi);
              if (typeof idx === 'number' && idx >= 0) setPageText(`${idx + 1} / ${locs.total}`);
            } catch { /* skip */ }
          }
        }
      })();

      const epubInstance = epub;

      // Creates the rendition + wires every handler. Paginated flow with the default view
      // manager (column-based page turns). Called once per book mount.
      const createRendition = (): Rendition => {
        const r = epubInstance.renderTo(container, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated',
        });
        renditionRef.current = r;

        // Reading surface (light/sepia/dark). themes.default reliably applies on render
        // (CSS custom properties don't cross the iframe, so colours are literals).
        r.themes.default(surfaceTheme(readingSurfaceRef.current));
        r.themes.fontSize(`${100 + fontOffsetRef.current}%`);

        r.on('displayed', () => setLoading(false));

        // Per-iframe setup: Ctrl+wheel zoom, parent-document activity ping (for chrome
        // auto-hide), Newsreader font injection, and our own selection→popover handler.
        // Done once per fresh document.
        const attachedDocs = new Set<Document>();
        r.on('rendered', () => {
          const doc = container.querySelector('iframe')?.contentDocument;
          if (!doc || attachedDocs.has(doc)) return;
          doc.addEventListener('wheel', handleZoomWheel, { passive: false });
          const ping = () => window.dispatchEvent(new Event('reader-activity'));
          doc.addEventListener('mousemove', ping);
          doc.addEventListener('mousedown', ping);
          // Selection→popover: we read the live selection on mouseup/touchend and
          // build the popover ourselves. rendition.on('selected') turned out to drop
          // most events during back-to-back selections (verified: 1/20 fires) — our
          // own listener gets every commit because we look at the DOM directly
          // instead of waiting for epub.js's debounced internal pipeline.
          const handleLiveSelection = () => {
            const win = doc.defaultView;
            if (!win) return;
            const sel = win.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const text = range.toString().trim();
            if (!text) return;
            // Convert the live DOM Range to an epubcfi via the matching Contents
            // instance (paginated mode usually has one, but match by document so we
            // don't pick a stale one after a section change).
            let cfiStr = '';
            try {
              // epub.js's typings claim getContents() returns a single Contents, but at
              // runtime it returns an array — cast around the bad type.
              const getContents = (r as unknown as {
                getContents: () => Array<{
                  document: Document;
                  cfiFromRange: (rng: Range) => { toString(): string } | string;
                }>;
              }).getContents;
              const all = getContents.call(r);
              const ours = all.find((c) => c.document === doc);
              if (!ours) return;
              const cfi = ours.cfiFromRange(range);
              cfiStr = typeof cfi === 'string' ? cfi : cfi.toString();
            } catch {
              return;
            }
            if (!cfiStr) return;
            const rect = range.getBoundingClientRect();
            const iframe = container.querySelector('iframe');
            const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
            const x = rect.left + iframeRect.left + rect.width / 2;
            const y = rect.top + iframeRect.top;
            // Snapshot the current page number so the resulting annotation carries
            // it. Prefer the GLOBAL number from side.locations (cross-section, real
            // 'page 42 / 156'); fall back to the section-local displayed.page if
            // locations haven't generated yet. Both reads are wrapped because epub.js
            // can throw on either path before the manager / index is wired.
            let pageNum: number | undefined;
            const side = sideRef.current as unknown as {
              locations?: {
                total: number;
                locationFromCfi: (cfi: string) => number;
              };
            } | null;
            if (side?.locations && side.locations.total > 0) {
              try {
                const idx = side.locations.locationFromCfi(cfiStr);
                if (typeof idx === 'number' && idx >= 0) pageNum = idx + 1;
              } catch {
                /* fall through to section-local */
              }
            }
            if (pageNum === undefined) {
              try {
                const loc = r.currentLocation() as
                  | { start?: { displayed?: { page?: number } } }
                  | undefined
                  | null;
                const p = loc?.start?.displayed?.page;
                if (typeof p === 'number' && p > 0) pageNum = p;
              } catch {
                /* page stays undefined */
              }
            }
            // Dedup against a stale state object if the same CFI is already shown
            // (e.g. mouseup followed by a touchend on the same commit) — avoids a
            // useless re-render.
            setPopover((prev) =>
              prev && prev.cfiRange === cfiStr
                ? prev
                : { x, y, text, cfiRange: cfiStr, chapter, page: pageNum },
            );
          };
          doc.addEventListener('mouseup', handleLiveSelection);
          doc.addEventListener('touchend', handleLiveSelection);
          // Swipe-to-turn-pages on the EPUB text itself — iframe events don't bubble
          // to the parent .page, so the wrapper-level listener can't see them. Same
          // handler, passive listeners; the thresholds in onSwipeEnd keep selection
          // gestures (long-press + drag) and pure scrolls from triggering a turn.
          doc.addEventListener('touchstart', onSwipeStart, { passive: true });
          doc.addEventListener('touchend', onSwipeEnd, { passive: true });
          // Mobile fallback: Android Chrome fires touchend BEFORE the browser commits
          // the selection, so window.getSelection() is still collapsed at that moment
          // and handleLiveSelection bails. selectionchange fires through the lifetime
          // of the gesture (a lot), so we debounce 300ms — the user has stopped
          // dragging by then and the selection is final. setPopover dedupes by CFI so
          // a duplicate fire after mouseup/touchend already shipped is a no-op.
          let selTimer: number | null = null;
          doc.addEventListener('selectionchange', () => {
            if (selTimer !== null) window.clearTimeout(selTimer);
            selTimer = window.setTimeout(handleLiveSelection, 300);
          });
          if (doc.head && !doc.getElementById('remargin-reading-font')) {
            const fontLink = doc.createElement('link');
            fontLink.id = 'remargin-reading-font';
            fontLink.rel = 'stylesheet';
            fontLink.href =
              'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,400&display=swap';
            doc.head.appendChild(fontLink);
          }
          attachedDocs.add(doc);
        });

        r.on('relocated', (location: unknown) => {
          const loc = location as {
            start: {
              cfi: string;
              href: string;
              percentage: number;
              displayed?: { page?: number; total?: number };
            };
          };
          lastCfiRef.current = loc.start.cfi;
          const side = sideRef.current as unknown as {
            locations?: {
              total: number;
              percentageFromCfi: (cfi: string) => number;
              locationFromCfi: (cfi: string) => number;
            };
          } | null;
          const hasGlobal = !!(side?.locations && side.locations.total > 0);
          let pct = Math.round((loc.start.percentage || 0) * 100);
          if (hasGlobal) {
            try {
              const p = side!.locations!.percentageFromCfi(loc.start.cfi);
              if (Number.isFinite(p)) pct = Math.round(p * 100);
            } catch { /* keep coarse pct */ }
          }
          pct = Math.max(0, Math.min(100, pct));
          setPercentage(pct);

          // Global page number from the side instance's locations index (built once
          // per book + cached in localStorage). Falls back to the section-local
          // displayed.page until locations.generate finishes on first open.
          if (hasGlobal) {
            try {
              const idx = side!.locations!.locationFromCfi(loc.start.cfi);
              if (typeof idx === 'number' && idx >= 0) {
                setPageText(`${idx + 1} / ${side!.locations!.total}`);
              } else {
                setPageText('');
              }
            } catch {
              setPageText('');
            }
          } else {
            const d = loc.start.displayed;
            if (d && d.page && d.total) setPageText(`${d.page} / ${d.total}`);
            else setPageText('');
          }

          patchBook(book.id, {
            lastOpened: new Date().toISOString(),
            progress: pct,
            lastPosition: loc.start.cfi,
          });

          getCurrentChapter(epubInstance, loc.start.href).then((ch) => {
            if (ch) setChapter(ch);
          });

          // Page turned — margin-note anchors moved; recompute after layout settles.
          setRelocateTick((t) => t + 1);
        });

        // Iframe-level keys (Page Up/Down etc.). Document-level arrow keys are handled
        // by the standalone keydown effect below.
        r.on('keydown', ((e: KeyboardEvent) => shortcutKeyRef.current(e)) as (
          ...args: unknown[]
        ) => void);

        return r;
      };

      rendition = createRendition();

      const startCfi = initialCfiRef.current;
      if (startCfi) {
        rendition.display(startCfi);
      } else {
        rendition.display();
      }

      // Document-level arrow keys for page turning.
      handleKey = (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') renditionRef.current?.next();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') renditionRef.current?.prev();
        shortcutKeyRef.current(e);
      };
      document.addEventListener('keydown', handleKey);
    })();

    return () => {
      cancelled = true;
      if (handleKey) document.removeEventListener('keydown', handleKey);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      sideRef.current?.destroy();
      sideRef.current = null;
      try {
        renditionRef.current?.destroy();
      } catch {
        /* already destroyed */
      }
      renditionRef.current = null;
      epub?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Clicking an existing highlight opens the saved-highlight popover (recolour / edit
  // note / delete), positioned over the highlight like the create popover.
  const openSavedHighlight = useCallback((a: Annotation) => {
    const rendition = renditionRef.current;
    if (!rendition || a.anchor.kind !== 'epub') return;
    let range: Range | null = null;
    try {
      range = rendition.getRange(a.anchor.cfi);
    } catch {
      range = null;
    }
    const iframe = viewerRef.current?.querySelector('iframe');
    const iframeRect = iframe?.getBoundingClientRect() ?? { left: 0, top: 0 };
    if (range) {
      const rect = range.getBoundingClientRect();
      setSavedPopover({
        x: rect.left + iframeRect.left + rect.width / 2,
        y: rect.top + iframeRect.top,
        id: a.id,
      });
    } else {
      setSavedPopover({ x: window.innerWidth / 2, y: window.innerHeight / 2, id: a.id });
    }
  }, []);

  // Fallback for highlight clicks: epub.js's per-annotation callback can miss on touch
  // or when the SVG overlay is masked by content. Listen on every rendered iframe doc
  // for clicks, then hit-test the click point against each annotation's range rects.
  // First hit wins. Only fires when no active text selection exists — otherwise a
  // drag-select that ends inside an old highlight would steal the popover.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const wired = new Map<Document, (e: MouseEvent) => void>();
    const hitTest = (doc: Document, ev: MouseEvent) => {
      const winSel = doc.defaultView?.getSelection();
      if (winSel && !winSel.isCollapsed) return; // user is selecting text
      const x = ev.clientX;
      const y = ev.clientY;
      for (const a of annotationsRef.current) {
        if (a.anchor.kind !== 'epub') continue;
        let range: Range | null = null;
        try {
          range = rendition.getRange(a.anchor.cfi);
        } catch {
          range = null;
        }
        if (!range) continue;
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            openSavedHighlight(a);
            return;
          }
        }
      }
    };
    const attach = () => {
      const doc = viewerRef.current?.querySelector('iframe')?.contentDocument;
      if (!doc || wired.has(doc)) return;
      const onClick = (e: MouseEvent) => hitTest(doc, e);
      doc.addEventListener('click', onClick);
      wired.set(doc, onClick);
    };
    rendition.on('rendered', attach);
    rendition.on('relocated', attach);
    attach();
    return () => {
      for (const [doc, fn] of wired) {
        try {
          doc.removeEventListener('click', fn);
        } catch { /* doc may already be gone */ }
      }
      wired.clear();
    };
  }, [openSavedHighlight]);

  // Tracks which CFIs we've drawn on the current rendition, with their colour, so we
  // diff-paint (only the deltas) instead of repainting every highlight on every change.
  const drawnHighlightsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const want = new Map<string, { color: string; ann: Annotation }>();
    for (const a of annotations) {
      if (a.anchor.kind === 'epub') want.set(a.anchor.cfi, { color: a.color, ann: a });
    }

    // Remove highlights for annotations that no longer exist (deletions).
    for (const cfi of Array.from(drawnHighlightsRef.current.keys())) {
      if (!want.has(cfi)) {
        try {
          rendition.annotations.remove(cfi, 'highlight');
        } catch { /* already gone */ }
        drawnHighlightsRef.current.delete(cfi);
      }
    }

    // Add new highlights; update colour when an existing one changed (remove + re-add).
    // Critically, untouched highlights are skipped — re-painting them all on every
    // annotation change caused epub.js to nudge the rendition's scroll position back
    // toward the start when a new annotation was created mid-book.
    for (const [cfi, { color, ann }] of want) {
      const prevColor = drawnHighlightsRef.current.get(cfi);
      if (prevColor === color) continue;
      if (prevColor !== undefined) {
        try {
          rendition.annotations.remove(cfi, 'highlight');
        } catch { /* fine */ }
      }
      rendition.annotations.highlight(
        cfi,
        {},
        () => openSavedHighlight(ann),
        'hl',
        {
          fill: `var(--highlight-${color})`,
          'fill-opacity': '1',
          'mix-blend-mode': 'multiply',
        },
      );
      drawnHighlightsRef.current.set(cfi, color);
    }
  }, [annotations, openSavedHighlight]);

  // Recompute note positions whenever annotations, focus, or the page changes.
  useEffect(() => {
    recomputeNotePositions();
  }, [annotations, autoFocusId, relocateTick, recomputeNotePositions]);

  useEffect(() => {
    const onResize = () => recomputeNotePositions();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recomputeNotePositions]);

  // Apply + persist the reading font size; recompute note anchors after reflow.
  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${100 + fontOffset}%`);
    saveAppState({ ...loadAppState(), epubFontSizeOffset: fontOffset });
    const id = setTimeout(() => recomputeNotePositions(), 60);
    return () => clearTimeout(id);
  }, [fontOffset, recomputeNotePositions]);

  // Ctrl + wheel over the desk margins (outside the iframe).
  useEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    desk.addEventListener('wheel', handleZoomWheel, { passive: false });
    return () => desk.removeEventListener('wheel', handleZoomWheel);
  }, [handleZoomWheel]);

  // Two-finger pinch zoom on touch screens. The hook clamps internally.
  usePinchZoom(deskRef, zoomRef, setZoom, { min: ZOOM_MIN, max: ZOOM_MAX });

  // Swipe handler on .page itself — catches taps on the page's margin / chrome areas.
  // The iframe doc gets the same handler attached inside r.on('rendered') so swipes
  // over the actual EPUB text are also picked up.
  useEffect(() => {
    const el = pageElRef.current;
    if (!el) return;
    el.addEventListener('touchstart', onSwipeStart, { passive: true });
    el.addEventListener('touchend', onSwipeEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onSwipeStart);
      el.removeEventListener('touchend', onSwipeEnd);
    };
  }, [onSwipeStart, onSwipeEnd]);

  const drawHighlight = (cfi: string, color: HighlightColor) => {
    renditionRef.current?.annotations.highlight(cfi, {}, () => {}, 'hl', {
      fill: `var(--highlight-${color})`,
      'fill-opacity': '1',
      'mix-blend-mode': 'multiply',
    });
  };

  // Close the create-popover AND clear the iframe's selection. We deliberately keep
  // the live selection visible while the popover is open so the user can still drag
  // the system selection handles to extend the range — collapsing earlier would trap
  // them on whatever word the long-press first hit. Collapse happens on commit
  // (colour pick / save / dismiss), once the cfi is captured into the annotation.
  const closePopover = () => {
    try {
      const iframe = viewerRef.current?.querySelector('iframe');
      iframe?.contentWindow?.getSelection()?.removeAllRanges();
    } catch { /* iframe may have navigated away */ }
    setPopover(null);
  };

  const handleHighlight = (color: HighlightColor = 'yellow') => {
    if (!popover) return;
    const anchor: EpubAnchor = {
      kind: 'epub',
      cfi: popover.cfiRange,
      chapter: popover.chapter,
      page: popover.page,
    };
    const cfi = popover.cfiRange;
    addAnnotation(popover.text, anchor, color);
    closePopover();
    drawHighlight(cfi, color);
  };

  const handleNote = () => {
    if (!popover) return;
    const anchor: EpubAnchor = {
      kind: 'epub',
      cfi: popover.cfiRange,
      chapter: popover.chapter,
      page: popover.page,
    };
    const cfi = popover.cfiRange;
    const ann = addAnnotation(popover.text, anchor, 'yellow');
    closePopover();
    drawHighlight(cfi, 'yellow');
    if (ann) setAutoFocusId(ann.id);
  };

  // Mobile bottom sheet: create the highlight and save the note text inline.
  const handleSaveNoteFromPopover = (text: string) => {
    if (!popover) return;
    const anchor: EpubAnchor = {
      kind: 'epub',
      cfi: popover.cfiRange,
      chapter: popover.chapter,
      page: popover.page,
    };
    const cfi = popover.cfiRange;
    const ann = addAnnotation(popover.text, anchor, 'yellow');
    closePopover();
    drawHighlight(cfi, 'yellow');
    if (ann && text.trim()) updateAnnotation(ann.id, { note: text.trim() });
  };

  // Copy a formatted citation from the popover (used by the mobile bottom sheet).
  const handleCopyCitationFromPopover = () => {
    if (!popover) return;
    const locator = popover.page ? `p. ${popover.page}` : '';
    const citation = formatCitation(popover.text, book, locator);
    navigator.clipboard
      .writeText(citation)
      .then(() => showToast('Copied citation'))
      .catch(() => {});
  };

  const handleSaveNote = (id: string, text: string) => {
    updateAnnotation(id, { note: text });
    if (autoFocusId === id) setAutoFocusId(null);
  };

  // Saved-highlight popover actions (recolour / edit note / delete the clicked highlight).
  const recolorSaved = (color: HighlightColor) => {
    if (savedPopover) updateAnnotation(savedPopover.id, { color });
    setSavedPopover(null);
  };
  const editSavedNote = () => {
    if (savedPopover) setAutoFocusId(savedPopover.id);
    setSavedPopover(null);
  };
  const deleteSaved = () => {
    if (!savedPopover) return;
    const a = annotationsRef.current.find((x) => x.id === savedPopover.id);
    if (a?.anchor.kind === 'epub') {
      try {
        renditionRef.current?.annotations.remove(a.anchor.cfi, 'highlight');
      } catch {
        /* already gone */
      }
    }
    deleteAnnotation(savedPopover.id);
    setSavedPopover(null);
  };

  // Keyboard shortcuts over the current selection (ignored while typing in a note
  // field). Ctrl/Cmd+Shift+C copies a formatted citation; the selection lives in
  // the epub iframe, so its text comes from the open popover (set on 'selected').
  const handleShortcutKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault(); // search lives in the header always; just block the browser find
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (!popover) return;

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      const citation = formatCitation(popover.text, book, chapter || 'Chapter');
      navigator.clipboard
        .writeText(citation)
        .then(() => showToast('Copied citation'))
        .catch(() => {});
      return;
    }

    // 1–5 → instant highlight in the matching colour, then drop the iframe selection.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && KEY_COLORS[e.key]) {
      e.preventDefault();
      handleHighlight(KEY_COLORS[e.key]);
      const iframe = viewerRef.current?.querySelector('iframe');
      iframe?.contentWindow?.getSelection()?.removeAllRanges();
    }
  };
  shortcutKeyRef.current = handleShortcutKey;

  // Re-apply the reading-surface theme when it changes. themes.default updates the
  // ruleset (links/selection take effect on the next render); override flips the
  // visible text colour live, without a re-render.
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    r.themes.default(surfaceTheme(readingSurface));
    r.themes.override('color', surfaceInk(readingSurface));
  }, [readingSurface]);

  // --- In-book search (Ctrl+F) ---
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Full-text search across spine sections; cancellable and cached per query.
  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      searchSeqRef.current++;
      setSearchMatches([]);
      setSearchIndex(0);
      setSearching(false);
      return;
    }
    if (searchCacheRef.current?.query === q.toLowerCase()) {
      setSearchMatches(searchCacheRef.current.matches);
      setSearchIndex(0);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    // Search on a separate (unrendered) copy of the book — loading/unloading the
    // rendition's own spine sections corrupts live rendering and breaks display().
    const buf = await getBookFile(book.id);
    if (!buf || seq !== searchSeqRef.current) {
      if (seq === searchSeqRef.current) setSearching(false);
      return;
    }
    let side: EpubBook;
    try {
      side = ePub(buf.slice(0));
      await side.ready;
    } catch {
      if (seq === searchSeqRef.current) setSearching(false);
      return;
    }
    const matches: EpubSearchMatch[] = [];
    for (const item of side.spine.spineItems) {
      if (seq !== searchSeqRef.current) {
        side.destroy();
        return;
      }
      try {
        await item.load(side.load.bind(side));
        for (const f of item.find(q)) matches.push({ cfi: f.cfi, excerpt: f.excerpt });
      } catch {
        /* skip an unreadable section */
      } finally {
        item.unload();
      }
    }
    side.destroy();
    if (seq !== searchSeqRef.current) return;
    searchCacheRef.current = { query: q.toLowerCase(), matches };
    setSearching(false);
    setSearchMatches(matches);
    setSearchIndex(0);
  }, [book.id]);

  useEffect(() => {
    runSearch(debouncedSearch);
  }, [debouncedSearch, runSearch]);

  // Scrolled-doc reflows the page (a glitch), so we switch lazily on the first navigation
  // (navigateToCfi) and restore paginated once the query is cleared. searchFlowRef tracks
  // whether we actually switched.
  const searchFlowRef = useRef(false);
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !searchFlowRef.current || debouncedSearch.trim() !== '') return;
    // Stay on the exact match page the user was looking at when they closed
    // search. Prefer the last navigated match cfi over currentLocation, because
    // currentLocation in scrolled-doc returns the top-of-viewport cfi while the
    // match itself is scrolled into the middle via centerMatch() — paginating
    // from the top-of-viewport pushes the match a column or two down.
    const cfi = lastMatchCfiRef.current ?? rendition.currentLocation()?.start?.cfi;
    rendition.flow('paginated');
    if (cfi) rendition.display(cfi);
    searchFlowRef.current = false;
    lastMatchCfiRef.current = null;
  }, [debouncedSearch]);

  // Centre the active match in the visible reading viewport. Search switches flow to
  // 'scrolled-doc' (so a match deep in a long section is reachable by scrolling), the
  // text lives in an iframe inside epub.js's scroll container, which sits inside the
  // zoomable .desk; at zoom>1 the match can be off-screen in BOTH at once, so no single-
  // container scroll suffices. epub.js draws the highlight as an SVG overlay in the
  // *parent* document, nested under both scroll containers — scrollIntoView on it scrolls
  // every scroll ancestor together and lands the word at the viewport's middle. The
  // overlay is added async after display(), so retry until it appears.
  const centerMatch = useCallback(() => {
    const tryCenter = (attempt: number) => {
      const hits = viewerRef.current?.querySelectorAll('[ref="search-hit"]');
      const el = hits && hits.length ? hits[hits.length - 1] : null;
      if (!el) {
        if (attempt < 6) window.setTimeout(() => tryCenter(attempt + 1), 100);
        return;
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    };
    tryCenter(0);
  }, []);

  // Navigate to + highlight the active match whenever the index or result set changes.
  const navigateToCfi = useCallback(
    (cfi: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      // Lazily switch to scrolled-doc on the first jump (see the flow effect) so the
      // reflow happens during the jump, not the instant search opened.
      if (!searchFlowRef.current) {
        rendition.flow('scrolled-doc');
        searchFlowRef.current = true;
      }
      if (searchHighlightRef.current) {
        try {
          rendition.annotations.remove(searchHighlightRef.current, 'highlight');
        } catch {
          /* already gone */
        }
        searchHighlightRef.current = null;
      }
      rendition.display(cfi).then(() => {
        try {
          rendition.annotations.highlight(cfi, {}, () => {}, 'search-hit', {
            fill: 'var(--accent)',
            'fill-opacity': '0.35',
          });
          searchHighlightRef.current = cfi;
        } catch {
          /* highlight failed (e.g. cfi no longer resolvable) — navigation still happened */
        }
        // Remember the actual match cfi for the close-effect restore (separate
        // from searchHighlightRef which clearSearch nulls out before the close
        // effect fires).
        lastMatchCfiRef.current = cfi;
        centerMatch();
      });
    },
    [centerMatch],
  );

  useEffect(() => {
    const match = searchMatches[searchIndex];
    if (match) navigateToCfi(match.cfi);
  }, [searchIndex, searchMatches, navigateToCfi]);

  const gotoMatch = (i: number) => {
    if (!searchMatches.length) return;
    const n = searchMatches.length;
    setSearchIndex(((i % n) + n) % n);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    searchSeqRef.current++;
    const rendition = renditionRef.current;
    if (rendition && searchHighlightRef.current) {
      try {
        rendition.annotations.remove(searchHighlightRef.current, 'highlight');
      } catch {
        /* already gone */
      }
    }
    searchHighlightRef.current = null;
  };

  const timeLeft = wordCount
    ? formatDuration(readingMinutes(Math.max(0, wordCount * (1 - percentage / 100))))
    : null;

  return (
    <ReaderShell
      title={book.title}
      subtitle={pageText || undefined}
      progress={percentage}
      timeLeft={timeLeft}
      pageText={pageText}
      onPrev={() => renditionRef.current?.prev()}
      onNext={() => renditionRef.current?.next()}
      search={{
        query: searchQuery,
        onQueryChange: setSearchQuery,
        onPrev: () => gotoMatch(searchIndex - 1),
        onNext: () => gotoMatch(searchIndex + 1),
        onClose: clearSearch,
        current: searchMatches.length ? searchIndex + 1 : 0,
        total: searchMatches.length,
        searching,
      }}
      font={{
        onInc: () => setFontOffset((o) => clampFontOffset(o + FONT_STEP)),
        onDec: () => setFontOffset((o) => clampFontOffset(o - FONT_STEP)),
      }}
    >
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          <div
            ref={deskRef}
            className={`${styles.desk}${searchQuery ? ` ${styles.searching}` : ''}`}
          >
            <div
              ref={pageElRef}
              className={styles.page}
              style={{ '--zoom': zoom, transformOrigin: 'top center' } as CSSProperties}
            >
              <div className={styles.textZone}>
                {loading && <div className={styles.loading}>Loading book...</div>}
                <div ref={viewerRef} className={styles.viewer} />
              </div>

              <MarginNotes
                notes={notePositions}
                autoFocusId={autoFocusId}
                onSave={handleSaveNote}
                onDelete={deleteAnnotation}
                onBlurEmpty={() => setAutoFocusId(null)}
              />
            </div>
          </div>
        </div>

        {showAnnotations && (
          <AnnotationPanel
            annotations={annotations}
            book={book}
            onUpdate={updateAnnotation}
            onDelete={deleteAnnotation}
          />
        )}
      </div>

      {popover && (
        <HighlightPopover
          x={popover.x}
          y={popover.y}
          onHighlight={handleHighlight}
          onNote={handleNote}
          onSaveNote={handleSaveNoteFromPopover}
          onCopyCitation={handleCopyCitationFromPopover}
          onDismiss={closePopover}
        />
      )}

      {savedPopover && (
        <HighlightPopover
          x={savedPopover.x}
          y={savedPopover.y}
          onHighlight={recolorSaved}
          onNote={editSavedNote}
          onSaveNote={(text) => {
            updateAnnotation(savedPopover.id, { note: text });
            setSavedPopover(null);
          }}
          onCopyCitation={() => {
            const a = annotations.find((x) => x.id === savedPopover.id);
            if (!a || a.anchor.kind !== 'epub') return;
            const locator = a.anchor.page ? `p. ${a.anchor.page}` : '';
            const citation = formatCitation(a.highlightedText, book, locator);
            navigator.clipboard
              .writeText(citation)
              .then(() => showToast('Copied citation'))
              .catch(() => {});
          }}
          initialNote={annotations.find((a) => a.id === savedPopover.id)?.note ?? ''}
          onDelete={deleteSaved}
          noteLabel={
            annotations.find((a) => a.id === savedPopover.id)?.note.trim() ? 'Edit note' : 'Note'
          }
          onDismiss={() => setSavedPopover(null)}
        />
      )}

      <Toast message={toast} />
    </ReaderShell>
  );
}
