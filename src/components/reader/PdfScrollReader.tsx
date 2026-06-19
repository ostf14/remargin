import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Book, HighlightColor } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
import { getBookFile } from '../../services/storage';
import { ReaderShell } from './ReaderShell';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { Toast } from './Toast';
import { formatCitation } from '../../services/citation';
import { countPdfWords, readingMinutes, formatDuration } from '../../services/wordCount';
import { detectContentBoundsNorm, type ContentBoundsNorm } from '../../utils/detectContentBounds';
import styles from './PdfScrollReader.module.css';

interface PageDims {
  width: number;
  height: number;
}

interface SearchMatch {
  page: number;
  y: number;
}

interface SelPopover {
  page: number;
  x: number;
  y: number;
  text: string;
  rects: { x: number; y: number; width: number; height: number }[];
}

interface SavedPopover {
  id: string;
  x: number;
  y: number;
}

interface TextLayerInstance {
  render(): Promise<unknown>;
  cancel(): void;
}
type TextLayerCtor = new (params: {
  textContentSource: unknown;
  container: HTMLElement;
  viewport: unknown;
}) => TextLayerInstance;

type LineRect = { left: number; top: number; right: number; bottom: number };

// pdf.js text spans are absolutely-positioned and transparent — the visible glyphs are the
// canvas. range.getClientRects() returns one rect per span, leaving visible gaps between
// words; merge into per-line bands so the saved highlight reads as a continuous strip.
function computeSelectionLineRects(textLayer: HTMLElement, pageContainer: HTMLElement): LineRect[] {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const base = pageContainer.getBoundingClientRect();
  const raw: LineRect[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (!range.intersectsNode(textLayer)) continue;
    const clientRects = range.getClientRects();
    for (let j = 0; j < clientRects.length; j++) {
      const r = clientRects[j];
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.height > base.height * 0.5) continue;
      if (r.bottom <= base.top || r.top >= base.bottom) continue;
      if (r.right <= base.left || r.left >= base.right) continue;
      raw.push({
        left: r.left - base.left,
        top: r.top - base.top,
        right: r.right - base.left,
        bottom: r.bottom - base.top,
      });
    }
  }
  if (!raw.length) return [];
  raw.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: LineRect[] = [];
  for (const r of raw) {
    const line = lines[lines.length - 1];
    if (line && r.top < line.bottom - 1 && r.bottom > line.top + 1) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

interface Props {
  book: Book;
}

// Continuous-scroll PDF reader. Every page is a sibling wrapper in one tall scroll
// container; only pages within the lazy window (current ± LAZY_NEIGHBOURHOOD) actually
// paint a canvas + text layer. The rest stay as same-sized placeholder boxes so the total
// scroll height matches the real document — scrolling is responsive even on long PDFs.
const LAZY_NEIGHBOURHOOD = 2;

export function PdfScrollReader({ book }: Props) {
  const { showAnnotations, trimMargins, setTrimMargins } = useReader();
  const { patchBook } = useLibrary();
  const { annotations, addAnnotation, updateAnnotation, deleteAnnotation } = useAnnotations(book.id);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Per-page detect cache for trim margins (same shape as the paginated reader's).
  const trimNormsRef = useRef<Map<number, ContentBoundsNorm>>(new Map());

  const [pdfReady, setPdfReady] = useState(false);
  const [totalPages, setTotalPages] = useState(book.totalPages || 0);
  const [pageDims, setPageDims] = useState<Map<number, PageDims>>(new Map());
  const [currentPage, setCurrentPage] = useState(Number(book.lastPosition) || 1);
  const [progressPct, setProgressPct] = useState(book.progress ?? 0);
  const [wordCount, setWordCount] = useState(book.wordCount);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const [selPopover, setSelPopover] = useState<SelPopover | null>(null);
  const [savedPopover, setSavedPopover] = useState<SavedPopover | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1500);
  }, []);

  // Search state — same model as the paginated reader's.
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const searchSeqRef = useRef(0);
  const searchCacheRef = useRef<{ query: string; matches: SearchMatch[] } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Load the PDF once. Grab page-1 size and width/height per page (cheap getViewport
  // calls) so every wrapper has a stable height even before it paints.
  useEffect(() => {
    let cancelled = false;
    trimNormsRef.current = new Map();
    (async () => {
      const arrayBuf = await getBookFile(book.id);
      if (cancelled || !arrayBuf) return;
      const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      if (cancelled) return;
      pdfRef.current = pdf;
      setTotalPages(pdf.numPages);

      // Word count for the reading-time estimate (background).
      if (book.wordCount === undefined) {
        countPdfWords(pdf)
          .then((words) => {
            if (!cancelled && words > 0) {
              setWordCount(words);
              patchBook(book.id, { wordCount: words });
            }
          })
          .catch(() => {});
      }

      // Walk all pages up-front: cheap getPage + scale-1 viewport so we know every
      // page's dimensions and can show correctly-sized placeholders.
      const dims = new Map<number, PageDims>();
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        try {
          const p = await pdf.getPage(i);
          const v = p.getViewport({ scale: 1 });
          dims.set(i, { width: v.width, height: v.height });
        } catch {
          /* skip — placeholder stays at a fallback ratio */
        }
      }
      if (cancelled) return;
      setPageDims(dims);
      setPdfReady(true);
    })();

    return () => {
      cancelled = true;
      pdfRef.current?.cleanup();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [book.id, book.wordCount, patchBook]);

  // After the placeholders mount with their real heights, jump to the saved page.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (!pdfReady || didInitialScrollRef.current) return;
    const wrap = containerRef.current;
    const target = pageRefs.current.get(currentPage);
    if (wrap && target) {
      didInitialScrollRef.current = true;
      wrap.scrollTop = target.offsetTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfReady]);

  // Track which page is centred in the viewport so the header subtitle and the saved
  // lastPosition stay accurate. rAF-coalesced — scroll fires very often.
  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap || !pdfReady) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const c = wrap.scrollTop + wrap.clientHeight / 2;
        let best = currentPage;
        let bestDist = Infinity;
        for (const [num, el] of pageRefs.current.entries()) {
          const mid = el.offsetTop + el.offsetHeight / 2;
          const d = Math.abs(mid - c);
          if (d < bestDist) {
            bestDist = d;
            best = num;
          }
        }
        if (best !== currentPage) setCurrentPage(best);
        const max = Math.max(1, wrap.scrollHeight - wrap.clientHeight);
        setProgressPct(Math.round((wrap.scrollTop / max) * 100));
      });
    };
    wrap.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      wrap.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pdfReady, currentPage]);

  // Persist progress + last page once it settles.
  useEffect(() => {
    if (!pdfReady) return;
    patchBook(book.id, {
      lastOpened: new Date().toISOString(),
      progress: progressPct,
      lastPosition: String(currentPage),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, progressPct, pdfReady]);

  // Saved highlights & selection-band painting are handled inside each PdfScrollPage.
  // The popover actions live up here so they share book/citation/toast plumbing.

  const handleCreateHighlight = (color: HighlightColor) => {
    if (!selPopover) return;
    addAnnotation(
      selPopover.text,
      { kind: 'pdf', page: selPopover.page, rects: selPopover.rects },
      color,
    );
    document.getSelection()?.removeAllRanges();
    setSelPopover(null);
  };

  const handleSaveNoteFromPopover = (text: string) => {
    if (!selPopover) return;
    const ann = addAnnotation(
      selPopover.text,
      { kind: 'pdf', page: selPopover.page, rects: selPopover.rects },
      'yellow',
    );
    if (ann && text.trim()) updateAnnotation(ann.id, { note: text.trim() });
    document.getSelection()?.removeAllRanges();
    setSelPopover(null);
  };

  const handleCopyCitationFromPopover = () => {
    if (!selPopover) return;
    const citation = formatCitation(selPopover.text, book, `с. ${selPopover.page}`);
    navigator.clipboard
      .writeText(citation)
      .then(() => showToast('Copied citation'))
      .catch(() => {});
  };

  // Full-document search (same approach as the paginated reader).
  const runSearch = useCallback(async (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) {
      searchSeqRef.current++;
      setSearchMatches([]);
      setSearchIndex(0);
      setSearching(false);
      return;
    }
    if (searchCacheRef.current?.query === q) {
      setSearchMatches(searchCacheRef.current.matches);
      setSearchIndex(0);
      return;
    }
    const pdf = pdfRef.current;
    if (!pdf) return;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const matches: SearchMatch[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (seq !== searchSeqRef.current) return;
      const pg = await pdf.getPage(p);
      const pageH = pg.getViewport({ scale: 1 }).height;
      const tc = await pg.getTextContent();
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const item = it as { str: string; transform: number[] };
        const lower = item.str.toLowerCase();
        if (!lower.includes(q)) continue;
        const f = item.transform?.[5] ?? 0;
        const y = pageH > 0 ? Math.max(0, Math.min(1, (pageH - f) / pageH)) : 0.5;
        let idx = lower.indexOf(q);
        while (idx !== -1) {
          matches.push({ page: p, y });
          idx = lower.indexOf(q, idx + q.length);
        }
      }
    }
    if (seq !== searchSeqRef.current) return;
    searchCacheRef.current = { query: q, matches };
    setSearching(false);
    setSearchMatches(matches);
    setSearchIndex(0);
  }, []);

  useEffect(() => {
    runSearch(debouncedSearch);
  }, [debouncedSearch, runSearch]);

  // Scroll an active match to vertical centre. Wait for the page wrapper to exist + paint
  // so its real height is known.
  useEffect(() => {
    const match = searchMatches[searchIndex];
    if (!match) return;
    const wrap = containerRef.current;
    if (!wrap) return;
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const target = pageRefs.current.get(match.page);
      if (target && target.offsetHeight > 1) {
        const targetTop = target.offsetTop + match.y * target.offsetHeight;
        wrap.scrollTo({ top: targetTop - wrap.clientHeight / 2, behavior: 'smooth' });
        return;
      }
      if (tries++ < 60) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [searchIndex, searchMatches]);

  const gotoMatch = (i: number) => {
    if (!searchMatches.length) return;
    const n = searchMatches.length;
    setSearchIndex(((i % n) + n) % n);
  };
  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    searchSeqRef.current++;
  };

  // Ctrl+wheel zoom (same UX as the paginated reader).
  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.5, Math.min(3, z - e.deltaY * 0.002)));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  const zoomIn = () => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));

  // Saved highlight click → open popover near it.
  const onSavedHighlightClick = (id: string, x: number, y: number) => {
    setSelPopover(null);
    setSavedPopover({ id, x, y });
  };

  // Mouse-up inside a page's text layer → snapshot the selection's text + page-coord
  // rects and pop the create-popover above it.
  const onPageSelected = (page: number, x: number, y: number, text: string, rects: SelPopover['rects']) => {
    setSavedPopover(null);
    setSelPopover({ page, x, y, text, rects });
  };

  const timeLeft = wordCount
    ? formatDuration(readingMinutes(Math.max(0, wordCount * (1 - progressPct / 100))))
    : null;
  const progressText = `${progressPct}%${timeLeft ? ` · ~${timeLeft} left` : ''}`;

  return (
    <ReaderShell
      title={book.title}
      subtitle={`Page ${currentPage} / ${totalPages}`}
      progress={progressPct}
      progressText={progressText}
      // No paginated turns in scroll mode — hide the side chevrons.
      showNav={false}
      onPrev={() => {}}
      onNext={() => {}}
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
      zoom={{ value: zoom, onIn: zoomIn, onOut: zoomOut }}
      trim={{ value: trimMargins, onToggle: () => setTrimMargins(!trimMargins) }}
    >
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          <div ref={containerRef} className={styles.scrollContainer}>
            <div className={styles.stack} style={{ width: '100%' }}>
              {Array.from({ length: totalPages }, (_, i) => {
                const num = i + 1;
                const dims = pageDims.get(num);
                const inWindow = Math.abs(num - currentPage) <= LAZY_NEIGHBOURHOOD;
                return (
                  <PdfScrollPage
                    key={num}
                    pageNum={num}
                    dims={dims}
                    render={inWindow && pdfReady}
                    pdf={pdfRef.current}
                    zoom={zoom}
                    trimMargins={trimMargins}
                    trimNormsRef={trimNormsRef}
                    annotations={annotationsRef}
                    onSelected={onPageSelected}
                    onSavedHighlightClick={onSavedHighlightClick}
                    setWrapperRef={(el) => {
                      if (el) pageRefs.current.set(num, el);
                      else pageRefs.current.delete(num);
                    }}
                  />
                );
              })}
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

      {selPopover && (
        <HighlightPopover
          x={selPopover.x}
          y={selPopover.y}
          onHighlight={handleCreateHighlight}
          onNote={() => {
            // Desktop: same as paginated — save the highlight + auto-focus the (here-absent)
            // margin card. Without margin notes in scroll mode, we just save yellow.
            const ann = addAnnotation(
              selPopover.text,
              { kind: 'pdf', page: selPopover.page, rects: selPopover.rects },
              'yellow',
            );
            document.getSelection()?.removeAllRanges();
            setSelPopover(null);
            if (ann) showToast('Highlighted');
          }}
          onSaveNote={handleSaveNoteFromPopover}
          onCopyCitation={handleCopyCitationFromPopover}
          onDismiss={() => setSelPopover(null)}
        />
      )}

      {savedPopover && (
        <HighlightPopover
          x={savedPopover.x}
          y={savedPopover.y}
          onHighlight={(color) => {
            updateAnnotation(savedPopover.id, { color });
            setSavedPopover(null);
          }}
          onNote={() => setSavedPopover(null)}
          onSaveNote={(text) => {
            updateAnnotation(savedPopover.id, { note: text });
            setSavedPopover(null);
          }}
          onCopyCitation={() => {
            const a = annotations.find((x) => x.id === savedPopover.id);
            if (!a || a.anchor.kind !== 'pdf') return;
            const citation = formatCitation(a.highlightedText, book, `с. ${a.anchor.page}`);
            navigator.clipboard
              .writeText(citation)
              .then(() => showToast('Copied citation'))
              .catch(() => {});
          }}
          initialNote={annotations.find((a) => a.id === savedPopover.id)?.note ?? ''}
          noteLabel={
            annotations.find((a) => a.id === savedPopover.id)?.note.trim() ? 'Edit note' : 'Note'
          }
          onDelete={() => {
            deleteAnnotation(savedPopover.id);
            setSavedPopover(null);
          }}
          onDismiss={() => setSavedPopover(null)}
        />
      )}

      <Toast message={toast} />
    </ReaderShell>
  );
}

// ───────────────────────── per-page wrapper ─────────────────────────

interface PageProps {
  pageNum: number;
  dims: PageDims | undefined;
  render: boolean;
  pdf: PDFDocumentProxy | null;
  zoom: number;
  trimMargins: boolean;
  trimNormsRef: React.MutableRefObject<Map<number, ContentBoundsNorm>>;
  annotations: React.MutableRefObject<ReturnType<typeof useAnnotations>['annotations']>;
  onSelected: (page: number, x: number, y: number, text: string, rects: SelPopover['rects']) => void;
  onSavedHighlightClick: (id: string, clientX: number, clientY: number) => void;
  setWrapperRef: (el: HTMLDivElement | null) => void;
}

function PdfScrollPage({
  pageNum,
  dims,
  render,
  pdf,
  zoom,
  trimMargins,
  trimNormsRef,
  annotations,
  onSelected,
  onSavedHighlightClick,
  setWrapperRef,
}: PageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const renderSeqRef = useRef(0);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const currentTextLayerRef = useRef<TextLayerInstance | null>(null);
  const baseScaleRef = useRef(1);
  const trimOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rendered, setRendered] = useState(false);

  // Forward our wrapper ref to the parent's per-page map.
  useEffect(() => {
    setWrapperRef(wrapperRef.current);
    return () => setWrapperRef(null);
  }, [setWrapperRef]);

  // Repaint saved highlights — small helper called on annotation/zoom/trim change.
  const paintSavedHighlights = useCallback(() => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    layer.replaceChildren();
    const scale = baseScaleRef.current;
    for (const a of annotations.current) {
      if (a.anchor.kind !== 'pdf' || a.anchor.page !== pageNum) continue;
      for (const r of a.anchor.rects) {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = `${r.x * scale}px`;
        div.style.top = `${r.y * scale}px`;
        div.style.width = `${r.width * scale}px`;
        div.style.height = `${r.height * scale}px`;
        div.style.background = `var(--highlight-${a.color})`;
        div.style.borderRadius = '2px';
        div.dataset.annId = a.id;
        layer.append(div);
      }
    }
  }, [pageNum, annotations]);

  // Render this page. Called when `render` flips on, on zoom changes (debounced via the
  // effect deps), and on trim toggles.
  useEffect(() => {
    if (!render || !pdf) return;
    let cancelled = false;
    const seq = ++renderSeqRef.current;
    renderTaskRef.current?.cancel();
    currentTextLayerRef.current?.cancel();
    currentTextLayerRef.current = null;

    (async () => {
      try {
        const p = await pdf.getPage(pageNum);
        if (cancelled || seq !== renderSeqRef.current) return;

        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const unscaled = p.getViewport({ scale: 1 });

        // Fit the page to the wrapper's intrinsic width (parent stack column).
        const containerW = wrapper.clientWidth || 800;
        let baseScale = containerW / unscaled.width;

        // Trim margins: detect crop rect (cached normalised), then bump baseScale so the
        // cropped width fills the container.
        let trimNorm: ContentBoundsNorm | null = null;
        if (trimMargins) {
          let cached = trimNormsRef.current.get(pageNum);
          if (!cached) {
            try {
              const detVp = p.getViewport({ scale: 0.3 });
              const det = document.createElement('canvas');
              det.width = Math.floor(detVp.width);
              det.height = Math.floor(detVp.height);
              const detCtx = det.getContext('2d');
              if (detCtx) {
                await p.render({ canvasContext: detCtx, viewport: detVp }).promise;
                if (cancelled || seq !== renderSeqRef.current) return;
                cached = detectContentBoundsNorm(det);
                trimNormsRef.current.set(pageNum, cached);
              }
            } catch {
              /* detection failed — fall back to no trim for this page */
            }
          }
          if (cached) {
            const normW = Math.max(0.1, cached.right - cached.left);
            baseScale = baseScale / normW;
            trimNorm = cached;
          }
        }
        trimOffsetRef.current = trimNorm
          ? { x: trimNorm.left * unscaled.width, y: trimNorm.top * unscaled.height }
          : { x: 0, y: 0 };

        // Scroll-mode zoom: re-render the canvas at the zoomed size, no CSS transform.
        // Stored highlights and selection coords use baseScaleRef = visualScale so they
        // all stay aligned to the visible pixels.
        const visualScale = baseScale * zoom;
        baseScaleRef.current = visualScale;
        const baseViewport = p.getViewport({ scale: visualScale });
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = Math.floor(baseViewport.width);
        const cssHeight = Math.floor(baseViewport.height);

        const offscreen = document.createElement('canvas');
        offscreen.width = Math.floor(cssWidth * dpr);
        offscreen.height = Math.floor(cssHeight * dpr);
        const offCtx = offscreen.getContext('2d')!;
        const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
        const task = p.render({ canvasContext: offCtx, viewport: baseViewport, transform });
        renderTaskRef.current = task;
        try {
          await task.promise;
        } catch (e: unknown) {
          if (e instanceof Error && /cancel/i.test(`${e.name} ${e.message}`)) return;
          throw e;
        }
        if (cancelled || seq !== renderSeqRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.getContext('2d')!.drawImage(offscreen, 0, 0);

        // Apply trim crop to pageContainer (so the wrapper's height reflects the cropped
        // page, not the original) and shift canvas/textLayer/highlightLayer up-left.
        const pageContainer = pageContainerRef.current;
        const textLayer = textLayerRef.current;
        const highlightLayer = highlightLayerRef.current;
        if (trimNorm && pageContainer) {
          const cropLeftCss = trimNorm.left * cssWidth;
          const cropTopCss = trimNorm.top * cssHeight;
          const cropWidthCss = (trimNorm.right - trimNorm.left) * cssWidth;
          const cropHeightCss = (trimNorm.bottom - trimNorm.top) * cssHeight;
          const translate = `translate(${-cropLeftCss}px, ${-cropTopCss}px)`;
          pageContainer.style.width = `${cropWidthCss}px`;
          pageContainer.style.height = `${cropHeightCss}px`;
          pageContainer.style.overflow = 'hidden';
          canvas.style.transform = translate;
          if (textLayer) textLayer.style.transform = translate;
          if (highlightLayer) highlightLayer.style.transform = translate;
        } else if (pageContainer) {
          pageContainer.style.width = `${cssWidth}px`;
          pageContainer.style.height = `${cssHeight}px`;
          pageContainer.style.overflow = '';
          canvas.style.transform = '';
          if (textLayer) textLayer.style.transform = '';
          if (highlightLayer) highlightLayer.style.transform = '';
        }

        paintSavedHighlights();

        // Build the transparent text layer for selection.
        const layerEl = textLayerRef.current;
        if (!layerEl) return;
        currentTextLayerRef.current?.cancel();
        layerEl.replaceChildren();
        layerEl.style.setProperty('--scale-factor', String(visualScale));
        const textContentSource = p.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        });
        const TextLayer = (pdfjsLib as unknown as { TextLayer: TextLayerCtor }).TextLayer;
        const tl = new TextLayer({ textContentSource, container: layerEl, viewport: baseViewport });
        currentTextLayerRef.current = tl;
        try {
          await tl.render();
        } catch {
          /* cancelled by a newer render */
          return;
        }
        if (cancelled || seq !== renderSeqRef.current || currentTextLayerRef.current !== tl) return;

        setRendered(true);
      } catch {
        /* swallow — the wrapper stays as a placeholder */
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      currentTextLayerRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, pdf, zoom, trimMargins, pageNum]);

  // Repaint saved highlights when the annotation set changes (mid-session edits).
  useEffect(() => {
    if (rendered) paintSavedHighlights();
  }, [rendered, paintSavedHighlights]);

  // Selection band painted into selectionLayer, then on mouse-up snapshot + bubble up.
  useEffect(() => {
    if (!render) return;
    const layer = textLayerRef.current;
    const pageContainer = pageContainerRef.current;
    const selectionLayer = selectionLayerRef.current;
    if (!layer || !pageContainer || !selectionLayer) return;

    const paint = () => {
      selectionLayer.replaceChildren();
      // No CSS zoom transform in scroll mode — selectionLayer is at the same scale as
      // the canvas/textLayer, so line rects (already in pageContainer-local px from
      // getClientRects) map 1:1 into the layer's coord system.
      for (const line of computeSelectionLineRects(layer, pageContainer)) {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = `${line.left}px`;
        div.style.top = `${line.top}px`;
        div.style.width = `${line.right - line.left}px`;
        div.style.height = `${line.bottom - line.top}px`;
        div.style.background = 'rgba(252, 211, 77, 0.35)';
        div.style.borderRadius = '2px';
        selectionLayer.append(div);
      }
    };
    const onMouseDown = () => {
      selectionLayer.replaceChildren();
    };
    const onMouseUp = () => {
      paint();
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      if (!range.intersectsNode(layer)) return;
      const lines = computeSelectionLineRects(layer, pageContainer);
      const off = trimOffsetRef.current;
      const scale = baseScaleRef.current || 1;
      const rects = lines.map((l) => ({
        x: l.left / scale + off.x,
        y: l.top / scale + off.y,
        width: (l.right - l.left) / scale,
        height: (l.bottom - l.top) / scale,
      }));
      if (!rects.length) return;
      const r = range.getBoundingClientRect();
      onSelected(pageNum, r.left + r.width / 2, r.top, text, rects);
    };

    layer.addEventListener('mousedown', onMouseDown);
    layer.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', paint);
    return () => {
      layer.removeEventListener('mousedown', onMouseDown);
      layer.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', paint);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, pageNum]);

  // Click on a saved highlight rect → forward to parent.
  const onPageContainerClick = (e: React.MouseEvent) => {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const layer = highlightLayerRef.current;
    if (!layer) return;
    const target = e.target as HTMLElement | null;
    if (target && layer.contains(target) && target.dataset.annId) {
      onSavedHighlightClick(target.dataset.annId, e.clientX, e.clientY);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={styles.pageWrapper}
      data-page-num={pageNum}
      // Aspect-ratio drives the placeholder height before the canvas paints; the canvas
      // itself dictates the wrapper's real size once it's rendered.
      style={rendered ? undefined : { aspectRatio: dims ? `${dims.width} / ${dims.height}` : '1 / 1.414' }}
    >
      <div className={styles.pageInner}>
        <div
          ref={pageContainerRef}
          className={styles.pageContainer}
          onClick={onPageContainerClick}
        >
          <canvas ref={canvasRef} />
          <div ref={highlightLayerRef} className={styles.highlightLayer} />
          <div ref={selectionLayerRef} className={styles.selectionLayer} />
          <div ref={textLayerRef} className="textLayer" />
        </div>
      </div>
      <div className={styles.pageLabel}>{pageNum}</div>
    </div>
  );
}
