import { useEffect, useRef, useState, useCallback } from 'react';
import ePub, { type Rendition, type Book as EpubBook } from 'epubjs';
import type { Book, EpubAnchor, HighlightColor } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
import { getBookFile, loadAppState, saveAppState } from '../../services/storage';
import { ReaderToolbar } from './ReaderToolbar';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { MarginNotes, type PositionedNote } from '../annotations/MarginNotes';
import styles from './EpubReader.module.css';

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
const ZOOM_STEP = 0.25;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

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
  const { updateBook } = useLibrary();
  const { showAnnotations } = useReader();
  const { annotations, addAnnotation, updateAnnotation, deleteAnnotation } =
    useAnnotations(book.id);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [chapter, setChapter] = useState('');
  const [percentage, setPercentage] = useState(book.progress ?? 0);
  const [loading, setLoading] = useState(true);
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

      rendition = epub.renderTo(container, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated',
      });
      renditionRef.current = rendition;

      // The page is always a cream sheet, so reading ink stays dark in both themes.
      rendition.themes.default({
        body: {
          background: 'transparent !important',
          color: '#2b2723 !important',
          'font-family': 'var(--font-serif) !important',
          'line-height': '1.7 !important',
          'padding': '0 !important',
          '-webkit-user-select': 'text !important',
          'user-select': 'text !important',
        },
        'a': { color: '#9a6a2f !important' },
        '::selection': {
          background: 'rgba(232, 200, 73, 0.4) !important',
        },
      });
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
          attachedDocs.add(doc);
        }
      });

      const epubInstance = epub;
      rendition.on('relocated', (location: unknown) => {
        const loc = location as { start: { cfi: string; href: string; percentage: number } };
        const pct = Math.round((loc.start.percentage || 0) * 100);
        setPercentage(pct);

        updateBook({
          ...book,
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
      };
      document.addEventListener('keydown', handleKey);
      rendition.on('keydown', handleKey as (...args: unknown[]) => void);
    })();

    return () => {
      cancelled = true;
      if (handleKey) document.removeEventListener('keydown', handleKey);
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

  return (
    <>
      <ReaderToolbar chapter={chapter} percentage={percentage} />
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          <div ref={deskRef} className={styles.desk}>
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

          <div className={styles.pageNav}>
            <button
              className={styles.pageBtn}
              onClick={() => renditionRef.current?.prev()}
            >
              &larr; Prev
            </button>
            <span className={styles.pageInfo}>
              {chapter || 'Chapter'} — {Math.round(percentage)}%
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => renditionRef.current?.next()}
            >
              Next &rarr;
            </button>
            <div className={styles.zoomGroup}>
              <button
                className={styles.pageBtn}
                onClick={() => setZoom((z) => clampZoom(+(z - ZOOM_STEP).toFixed(2)))}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
              >
                &minus;
              </button>
              <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
              <button
                className={styles.pageBtn}
                onClick={() => setZoom((z) => clampZoom(+(z + ZOOM_STEP).toFixed(2)))}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
              >
                +
              </button>
            </div>
            <div className={styles.fontGroup}>
              <button
                className={styles.pageBtn}
                onClick={() => setFontOffset((o) => clampFontOffset(o - FONT_STEP))}
                disabled={fontOffset <= FONT_MIN}
                title="Smaller text"
              >
                A&minus;
              </button>
              <button
                className={styles.pageBtn}
                onClick={() => setFontOffset((o) => clampFontOffset(o + FONT_STEP))}
                disabled={fontOffset >= FONT_MAX}
                title="Larger text"
              >
                A+
              </button>
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
    </>
  );
}
