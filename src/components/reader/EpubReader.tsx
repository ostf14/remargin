import { useEffect, useRef, useState, useCallback } from 'react';
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
  return {
    body: {
      background: 'transparent !important',
      color: `${ink} !important`,
      'font-family': "'Literata', Georgia, serif !important",
      'line-height': '1.7 !important',
      padding: '0 !important',
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

interface PopoverState {
  x: number;
  y: number;
  text: string;
  cfiRange: string;
  chapter: string;
}

export function EpubReader({ book }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const pageElRef = useRef<HTMLDivElement>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { patchBook } = useLibrary();
  const { showAnnotations, readingSurface, pendingAnchor, readerMode } = useReader();
  const readingSurfaceRef = useRef(readingSurface);
  readingSurfaceRef.current = readingSurface;
  const readerModeRef = useRef(readerMode);
  readerModeRef.current = readerMode;
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
  // Bumped on every rendition recreate (mode switch) so the annotations effect re-paints.
  const [renditionEpoch, setRenditionEpoch] = useState(0);
  // The mode-switch effect calls into the main useEffect's closure via this ref.
  const recreateRenditionRef = useRef<((mode: 'pages' | 'scroll') => void) | null>(null);
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

  // Ctrl + wheel = continuous visual zoom (blocks the browser's own page zoom).
  const handleZoomWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z - e.deltaY * 0.002));
  }, []);

  // Position margin notes opposite their highlight: resolve the cfi to a live
  // Range, take its on-screen top (offset by the iframe), relative to readerArea.
  // Ranges outside the visible page are skipped so only current-page notes show.
  const recomputeNotePositions = useCallback(() => {
    const rendition = renditionRef.current;
    const container = viewerRef.current;
    const iframe = container?.querySelector('iframe');
    if (!rendition || !iframe) {
      setNotePositions([]);
      return;
    }
    // The iframe's client box is its untransformed internal viewport — the page's
    // CSS zoom transform doesn't affect it, so positions computed here are stable.
    const iw = iframe.clientWidth;
    const ih = iframe.clientHeight;
    const result: PositionedNote[] = [];
    for (const a of annotationsRef.current) {
      if (a.anchor.kind !== 'epub') continue;
      if (a.note.trim() === '' && a.id !== autoFocusIdRef.current) continue;
      let range: Range | null = null;
      try {
        range = rendition.getRange(a.anchor.cfi);
      } catch {
        range = null;
      }
      if (!range) continue;
      const r = range.getBoundingClientRect();
      if (!r) continue;
      // r is in the iframe's own coordinate space; skip ranges off the current
      // page (paginated columns push others outside the viewport).
      if (r.right < 0 || r.left > iw || r.bottom < 0 || r.top > ih) continue;
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
      // estimate and build the locations index for accurate progress. Doing either on the
      // rendition's own book corrupts live rendering and percentages, so we keep it apart.
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
        try {
          await side.locations.generate(1200);
        } catch {
          /* progress falls back to epub.js' coarse percentage */
        }
        if (cancelled) {
          side.destroy();
          return;
        }
        sideRef.current = side;
        const cfi = lastCfiRef.current;
        if (cfi) {
          const p = side.locations.percentageFromCfi(cfi);
          if (Number.isFinite(p)) setPercentage(Math.max(0, Math.min(100, Math.round(p * 100))));
        }
      })();

      const epubInstance = epub;

      // Creates a rendition + wires every handler. Called once at mount with the saved
      // mode, again from the mode-switch effect after destroying the previous rendition.
      // Scroll mode uses `flow: 'scrolled-doc'` with the DEFAULT view manager — the
      // current spine section scrolls vertically inside the viewer; prev/next moves
      // between sections. epub.js's "continuous" manager (which streamed the whole book
      // into one scroller) is unreliable: on many real-world EPUBs it loads only the
      // first section (often the ToC) and stops, and the initial layout race resizes
      // the cover image to zero. Per-section scrolled-doc is the robust default.
      const createRendition = (mode: 'pages' | 'scroll'): Rendition => {
        const r = epubInstance.renderTo(container, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: mode === 'scroll' ? 'scrolled-doc' : 'paginated',
        });
        renditionRef.current = r;

        // Reading surface (light/sepia/dark). themes.default reliably applies on render
        // (CSS custom properties don't cross the iframe, so colours are literals).
        r.themes.default(surfaceTheme(readingSurfaceRef.current));
        r.themes.fontSize(`${100 + fontOffsetRef.current}%`);

        r.on('displayed', () => setLoading(false));

        // Wheel events fire inside the content iframe — attach the Ctrl+wheel font
        // handler to each rendered document so the gesture is caught over the text.
        const attachedDocs = new Set<Document>();
        r.on('rendered', () => {
          const doc = container.querySelector('iframe')?.contentDocument;
          if (doc && !attachedDocs.has(doc)) {
            doc.addEventListener('wheel', handleZoomWheel, { passive: false });
            // Forward pointer activity inside the iframe so the chrome auto-hide timer
            // (which lives in the parent document) keeps resetting while reading EPUB.
            const ping = () => window.dispatchEvent(new Event('reader-activity'));
            doc.addEventListener('mousemove', ping);
            doc.addEventListener('mousedown', ping);
            // The rendered content is a separate document, so the parent's Google Fonts
            // <link> doesn't reach it — load the reading font (Literata) inside the iframe.
            // Falls back to Georgia (in the theme stack) if the request is blocked.
            if (doc.head && !doc.getElementById('remargin-reading-font')) {
              const fontLink = doc.createElement('link');
              fontLink.id = 'remargin-reading-font';
              fontLink.rel = 'stylesheet';
              fontLink.href =
                'https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,400;0,700;1,400&display=swap';
              doc.head.appendChild(fontLink);
            }
            attachedDocs.add(doc);
          }
        });

        r.on('relocated', (location: unknown) => {
          const loc = location as { start: { cfi: string; href: string; percentage: number } };
          lastCfiRef.current = loc.start.cfi;
          const side = sideRef.current;
          let pct = Math.round((loc.start.percentage || 0) * 100);
          if (side) {
            const p = side.locations.percentageFromCfi(loc.start.cfi);
            if (Number.isFinite(p)) pct = Math.round(p * 100);
          }
          pct = Math.max(0, Math.min(100, pct));
          setPercentage(pct);

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

        // 'selected' fires repeatedly: once when the long-press lands on a word, and
        // again every time the user drags one of the selection handles to extend the
        // range. Each fire updates the popover with the latest cfi/text; collapsing
        // the selection here would kill the drag handles and trap the user on the
        // first word. We collapse only after the user commits (picks a colour / saves
        // a note / dismisses) — see closePopover.
        r.on('selected', (cfiRange: unknown) => {
          const cfi = cfiRange as string;
          const range = r.getRange(cfi);
          if (!range) return;
          const text = range.toString().trim();
          if (!text) return;

          const rect = range.getBoundingClientRect();
          const iframe = container.querySelector('iframe');
          const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };

          setPopover({
            x: rect.left + iframeRect.left + rect.width / 2,
            y: rect.top + iframeRect.top,
            text,
            cfiRange: cfi,
            chapter: chapter || 'Unknown',
          });
        });

        // Iframe-level keys (Page Up/Down etc.). Document-level arrow keys are handled
        // by the standalone keydown effect below so they survive rendition recreation.
        r.on('keydown', ((e: KeyboardEvent) => shortcutKeyRef.current(e)) as (
          ...args: unknown[]
        ) => void);

        return r;
      };

      rendition = createRendition(readerModeRef.current === 'scroll' ? 'scroll' : 'pages');

      const startCfi = initialCfiRef.current;
      if (startCfi) {
        rendition.display(startCfi);
      } else {
        rendition.display();
      }

      // Expose the factory so the mode-switch effect can destroy + recreate.
      recreateRenditionRef.current = (mode) => {
        const cfi = renditionRef.current?.currentLocation()?.start?.cfi ?? lastCfiRef.current;
        try {
          renditionRef.current?.destroy();
        } catch {
          /* ignore — already gone */
        }
        container.innerHTML = '';
        const next = createRendition(mode);
        if (cfi) next.display(cfi);
        else next.display();
        setRenditionEpoch((e) => e + 1); // tells the annotations effect to re-paint
      };

      // Document-level arrow keys for page turning — independent of rendition lifecycle.
      handleKey = (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') renditionRef.current?.next();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') renditionRef.current?.prev();
        shortcutKeyRef.current(e);
      };
      document.addEventListener('keydown', handleKey);
    })();

    return () => {
      cancelled = true;
      recreateRenditionRef.current = null;
      if (handleKey) document.removeEventListener('keydown', handleKey);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      sideRef.current?.destroy();
      sideRef.current = null;
      // The most recent rendition lives in the ref (after any mode-switch recreate),
      // so destroy that one, not the stale `rendition` captured at mount.
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
  }, [openSavedHighlight, renditionEpoch]);

  // Tracks which CFIs we've drawn on the current rendition, with their colour. Resetting
  // on renditionEpoch (mode switch) is handled by re-running this effect — we also wipe
  // the map there.
  const drawnHighlightsRef = useRef<Map<string, string>>(new Map());
  const drawnEpochRef = useRef(-1);
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Wipe the tracking map on a rendition recreate — the new rendition has no SVG
    // overlays yet, so anything we "remembered drawing" needs to be re-added.
    if (renditionEpoch !== drawnEpochRef.current) {
      drawnHighlightsRef.current.clear();
      drawnEpochRef.current = renditionEpoch;
    }

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
  }, [annotations, openSavedHighlight, renditionEpoch]);

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
    const anchor: EpubAnchor = { kind: 'epub', cfi: popover.cfiRange, chapter: popover.chapter };
    const cfi = popover.cfiRange;
    addAnnotation(popover.text, anchor, color);
    closePopover();
    drawHighlight(cfi, color);
  };

  const handleNote = () => {
    if (!popover) return;
    const anchor: EpubAnchor = { kind: 'epub', cfi: popover.cfiRange, chapter: popover.chapter };
    const cfi = popover.cfiRange;
    const ann = addAnnotation(popover.text, anchor, 'yellow');
    closePopover();
    drawHighlight(cfi, 'yellow');
    if (ann) setAutoFocusId(ann.id);
  };

  // Mobile bottom sheet: create the highlight and save the note text inline.
  const handleSaveNoteFromPopover = (text: string) => {
    if (!popover) return;
    const anchor: EpubAnchor = { kind: 'epub', cfi: popover.cfiRange, chapter: popover.chapter };
    const cfi = popover.cfiRange;
    const ann = addAnnotation(popover.text, anchor, 'yellow');
    closePopover();
    drawHighlight(cfi, 'yellow');
    if (ann && text.trim()) updateAnnotation(ann.id, { note: text.trim() });
  };

  // Copy a formatted citation from the popover (used by the mobile bottom sheet).
  const handleCopyCitationFromPopover = () => {
    if (!popover) return;
    const citation = formatCitation(popover.text, book, popover.chapter || chapter || 'Chapter');
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
    const cfi = rendition.currentLocation()?.start?.cfi;
    rendition.flow('paginated');
    if (cfi) rendition.display(cfi);
    searchFlowRef.current = false;
  }, [debouncedSearch]);

  // Reading mode: scroll → scrolled-doc (continuous manager, whole book in one scroll),
  // pages → paginated (default manager). Skips the initial mount; recreating the
  // rendition wires the new manager and the destination CFI.
  const prevModeRef = useRef(readerMode);
  useEffect(() => {
    if (readerMode === prevModeRef.current) return;
    prevModeRef.current = readerMode;
    if (!recreateRenditionRef.current) return;
    // A search-flow toggle (paginated→scrolled-doc-temp) doesn't apply to the new
    // rendition; reset the flag so search's "restore paginated" effect doesn't undo us.
    searchFlowRef.current = false;
    recreateRenditionRef.current(readerMode === 'scroll' ? 'scroll' : 'pages');
    setRelocateTick((t) => t + 1);
  }, [readerMode]);

  // Centre the active match in the visible reading viewport — the same outcome the PDF
  // reader gives by scrolling its container to the match. In scrolled-doc mode the text
  // lives in an iframe inside epub.js's own scroll container, which itself sits inside
  // the zoomable .desk; at zoom>1 the match can be off-screen in BOTH at once, so no
  // single-container scroll suffices. epub.js draws the highlight as an SVG overlay in
  // the *parent* document, nested under both scroll containers — so scrollIntoView on it
  // scrolls every scroll ancestor together and lands the word at the viewport's middle
  // (vertical only, like the PDF; horizontal stays put unless the word is off-side).
  // The overlay is added async after display(), so retry until it appears.
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
      // reflow happens during the jump, not the instant search opened. In scroll reading
      // mode we're already scrolled-doc, so there's nothing to switch.
      if (readerModeRef.current !== 'scroll' && !searchFlowRef.current) {
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
  const progressText = `${Math.round(percentage)}%${timeLeft ? ` · ~${timeLeft} left` : ''}`;

  return (
    <ReaderShell
      title={book.title}
      subtitle={chapter || 'Chapter'}
      progress={percentage}
      progressText={progressText}
      showNav
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
            className={`${styles.desk}${searchQuery ? ` ${styles.searching}` : ''}${
              readerMode === 'scroll' ? ` ${styles.scrollMode}` : ''
            }`}
          >
            <div
              ref={pageElRef}
              className={styles.page}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
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
            const citation = formatCitation(a.highlightedText, book, a.anchor.chapter || chapter);
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
