import { useEffect, useRef, useState, useCallback } from 'react';
import ePub, { type Rendition, type Book as EpubBook } from 'epubjs';
import type { Book, EpubAnchor, HighlightColor, ReadingSurface } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
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
    },
    a: { color: `${link} !important` },
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
  const { showAnnotations, readingSurface } = useReader();
  const readingSurfaceRef = useRef(readingSurface);
  readingSurfaceRef.current = readingSurface;
  const lastCfiRef = useRef<string | null>(book.lastPosition);
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
  const [notePositions, setNotePositions] = useState<PositionedNote[]>([]);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const autoFocusIdRef = useRef<string | null>(null);
  autoFocusIdRef.current = autoFocusId;
  const [relocateTick, setRelocateTick] = useState(0);
  const [fontOffset, setFontOffset] = useState(() => clampFontOffset(loadAppState().epubFontSizeOffset));
  const fontOffsetRef = useRef(fontOffset);
  fontOffsetRef.current = fontOffset;
  const [zoom, setZoom] = useState(1);

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

  // In-book search (Ctrl+F).
  const [searchOpen, setSearchOpen] = useState(false);
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

      rendition = epub.renderTo(container, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated',
      });
      renditionRef.current = rendition;

      // Reading surface (light/sepia/dark). themes.default reliably applies on render
      // (CSS custom properties don't cross the iframe, so colours are literals).
      rendition.themes.default(surfaceTheme(readingSurfaceRef.current));
      rendition.themes.fontSize(`${100 + fontOffsetRef.current}%`);

      const startCfi = book.lastPosition;
      if (startCfi) {
        rendition.display(startCfi);
      } else {
        rendition.display();
      }

      rendition.on('displayed', () => setLoading(false));

      // Wheel events fire inside the content iframe — attach the Ctrl+wheel font
      // handler to each rendered document so the gesture is caught over the text.
      const attachedDocs = new Set<Document>();
      rendition.on('rendered', () => {
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

      const epubInstance = epub;
      rendition.on('relocated', (location: unknown) => {
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

      const renditionInstance = rendition;
      rendition.on('selected', (cfiRange: unknown) => {
        const cfi = cfiRange as string;
        const range = renditionInstance.getRange(cfi);
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

      handleKey = (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') renditionInstance.next();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') renditionInstance.prev();
        shortcutKeyRef.current(e);
      };
      document.addEventListener('keydown', handleKey);
      rendition.on('keydown', handleKey as (...args: unknown[]) => void);
    })();

    return () => {
      cancelled = true;
      if (handleKey) document.removeEventListener('keydown', handleKey);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      sideRef.current?.destroy();
      sideRef.current = null;
      rendition?.destroy();
      epub?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    annotations.forEach((a) => {
      if (a.anchor.kind === 'epub') {
        try {
          rendition.annotations.remove(a.anchor.cfi, 'highlight');
        } catch { /* ignore */ }
        rendition.annotations.highlight(
          a.anchor.cfi,
          {},
          () => {},
          'hl',
          {
            fill: `var(--highlight-${a.color})`,
            'fill-opacity': '1',
            'mix-blend-mode': 'multiply',
          },
        );
      }
    });
  }, [annotations]);

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

  const drawHighlight = (cfi: string, color: HighlightColor) => {
    renditionRef.current?.annotations.highlight(cfi, {}, () => {}, 'hl', {
      fill: `var(--highlight-${color})`,
      'fill-opacity': '1',
      'mix-blend-mode': 'multiply',
    });
  };

  const handleHighlight = (color: HighlightColor = 'yellow') => {
    if (!popover) return;
    const anchor: EpubAnchor = { kind: 'epub', cfi: popover.cfiRange, chapter: popover.chapter };
    addAnnotation(popover.text, anchor, color);
    setPopover(null);
    drawHighlight(popover.cfiRange, color);
  };

  const handleNote = () => {
    if (!popover) return;
    const anchor: EpubAnchor = { kind: 'epub', cfi: popover.cfiRange, chapter: popover.chapter };
    const ann = addAnnotation(popover.text, anchor, 'yellow');
    setPopover(null);
    drawHighlight(popover.cfiRange, 'yellow');
    if (ann) setAutoFocusId(ann.id);
  };

  const handleSaveNote = (id: string, text: string) => {
    updateAnnotation(id, { note: text });
    if (autoFocusId === id) setAutoFocusId(null);
  };

  // Keyboard shortcuts over the current selection (ignored while typing in a note
  // field). Ctrl/Cmd+Shift+C copies a formatted citation; the selection lives in
  // the epub iframe, so its text comes from the open popover (set on 'selected').
  const handleShortcutKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      setSearchOpen(true);
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
    if (searchOpen) runSearch(debouncedSearch);
  }, [debouncedSearch, searchOpen, runSearch]);

  // Switching to scrolled-doc reflows the page — a visible glitch if it fires the instant
  // search opens. So we defer the switch to the first navigation (navigateToCfi) and only
  // restore paginated here, on close. searchFlowRef tracks whether we actually switched.
  const searchFlowRef = useRef(false);
  useEffect(() => {
    const rendition = renditionRef.current;
    if (searchOpen || !rendition || !searchFlowRef.current) return;
    const cfi = rendition.currentLocation()?.start?.cfi;
    rendition.flow('paginated');
    if (cfi) rendition.display(cfi);
    searchFlowRef.current = false;
  }, [searchOpen]);

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
        centerMatch();
      });
    },
    [centerMatch],
  );

  useEffect(() => {
    const match = searchMatches[searchIndex];
    if (searchOpen && match) navigateToCfi(match.cfi);
  }, [searchIndex, searchMatches, searchOpen, navigateToCfi]);

  const gotoMatch = (i: number) => {
    if (!searchMatches.length) return;
    const n = searchMatches.length;
    setSearchIndex(((i % n) + n) % n);
  };

  const closeSearch = () => {
    setSearchOpen(false);
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
      onPrev={() => renditionRef.current?.prev()}
      onNext={() => renditionRef.current?.next()}
      onOpenSearch={() => setSearchOpen(true)}
      search={{
        open: searchOpen,
        query: searchQuery,
        onQueryChange: setSearchQuery,
        onPrev: () => gotoMatch(searchIndex - 1),
        onNext: () => gotoMatch(searchIndex + 1),
        onClose: closeSearch,
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
          <div ref={deskRef} className={`${styles.desk}${searchOpen ? ` ${styles.searching}` : ''}`}>
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
          onDismiss={() => setPopover(null)}
        />
      )}

      <Toast message={toast} />
    </ReaderShell>
  );
}
