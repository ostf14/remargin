import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Book } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
import { getBookFile } from '../../services/storage';
import { ReaderToolbar } from './ReaderToolbar';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import styles from './PdfReader.module.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextLayerInstance {
  render(): Promise<unknown>;
  cancel(): void;
}
type TextLayerCtor = new (params: {
  textContentSource: unknown;
  container: HTMLElement;
  viewport: unknown;
}) => TextLayerInstance;

// Port of pdf.js TextLayerBuilder selection stabilization (single-layer).
// The bare TextLayer class only renders spans; the ".endOfContent" helper div +
// these listeners are what keep a drag-selection a continuous band instead of
// jumping between lines. Mirrors web/pdf_viewer.mjs #bindMouse + selectionchange.
function bindTextLayerSelection(div: HTMLElement): () => void {
  const endOfContent = document.createElement('div');
  endOfContent.className = 'endOfContent';
  div.append(endOfContent);

  const reset = () => {
    div.append(endOfContent);
    endOfContent.style.width = '';
    endOfContent.style.height = '';
    endOfContent.classList.remove('active');
  };

  const onMouseDown = () => endOfContent.classList.add('active');
  const onPointerUp = () => reset();

  let prevRange: Range | null = null;
  const onSelectionChange = () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      reset();
      return;
    }
    let active = false;
    for (let i = 0; i < selection.rangeCount; i++) {
      if (selection.getRangeAt(i).intersectsNode(div)) {
        active = true;
        break;
      }
    }
    if (!active) {
      reset();
      return;
    }
    endOfContent.classList.add('active');

    const range = selection.getRangeAt(0);
    const modifyStart =
      !!prevRange &&
      (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    const anchorEl = anchor as HTMLElement | null;
    const parent = anchorEl?.parentElement;
    if (anchorEl && parent && parent.closest('.textLayer') === div) {
      endOfContent.style.width = div.style.width;
      endOfContent.style.height = div.style.height;
      parent.insertBefore(endOfContent, modifyStart ? anchorEl : anchorEl.nextSibling);
    }
    prevRange = range.cloneRange();
  };

  div.addEventListener('mousedown', onMouseDown);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('selectionchange', onSelectionChange);

  return () => {
    div.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('selectionchange', onSelectionChange);
    endOfContent.remove();
  };
}

// pdf.js text spans are transparent and only exist so the browser can build a
// Selection/Range. Native ::selection paints each absolutely-positioned span
// separately, leaving gaps between words — so we hide it and paint our own
// highlight from range.getClientRects(), merging same-line rects into one band.
function paintSelectionHighlight(
  textLayer: HTMLElement,
  pageContainer: HTMLElement,
  selectionLayer: HTMLElement,
) {
  selectionLayer.replaceChildren();
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const base = pageContainer.getBoundingClientRect();
  const raw: { left: number; top: number; right: number; bottom: number }[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (!range.intersectsNode(textLayer)) continue;
    const clientRects = range.getClientRects();
    for (let j = 0; j < clientRects.length; j++) {
      const r = clientRects[j];
      if (r.width <= 0 || r.height <= 0) continue;
      // Skip the full-page endOfContent helper rect (selection stabilizer).
      if (r.height > base.height * 0.5) continue;
      // Keep only rects that fall within this page.
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
  if (!raw.length) return;

  // Merge vertically-overlapping rects into one continuous band per line.
  raw.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: typeof raw = [];
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

  for (const line of lines) {
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
}

interface Props {
  book: Book;
}

export function PdfReader({ book }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const currentTextLayerRef = useRef<TextLayerInstance | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const { updateBook } = useLibrary();
  const { showAnnotations } = useReader();
  const { annotations, updateAnnotation, deleteAnnotation } = useAnnotations(book.id);
  const [page, setPage] = useState(Number(book.lastPosition) || 1);
  const [totalPages, setTotalPages] = useState(book.totalPages || 0);
  const [loading, setLoading] = useState(true);
  // renderScale = zoom the canvas is actually rasterized at; visualZoom = live
  // target. Zooming only updates visualZoom (instant CSS transform); the canvas
  // is re-rendered (debounced) once the user stops, then renderScale catches up.
  const [renderScale, setRenderScale] = useState(1);
  const [visualZoom, setVisualZoom] = useState(1);
  // Mirror live values into refs so renderPage (stable identity) reads the latest
  // without re-creating and without stale closures in timeouts/listeners.
  const visualZoomRef = useRef(1);
  visualZoomRef.current = visualZoom;
  const pageRef = useRef(page);
  pageRef.current = page;

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, num: number) => {
    if (!canvasRef.current) return;
    // Cancel any in-flight render so rapid zoom/page changes can't collide on the canvas.
    renderTaskRef.current?.cancel();

    const p = await pdf.getPage(num);

    // Fit-width base scale: page width filling the scroll container (minus padding),
    // multiplied by the user zoom level (1.0 = fit width).
    const unscaled = p.getViewport({ scale: 1 });
    let baseScale = 1;
    const wrap = canvasWrapRef.current;
    if (wrap) {
      const cs = getComputedStyle(wrap);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const avail = wrap.clientWidth - padX;
      if (avail > 0) baseScale = avail / unscaled.width;
    }
    const zoom = visualZoomRef.current;
    const scale = baseScale * zoom;
    const viewport = p.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.floor(viewport.width);
    const cssHeight = Math.floor(viewport.height);

    const canvas = canvasRef.current;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const canvasContext = canvas.getContext('2d')!;
    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
    const task = p.render({ canvasContext, viewport, transform });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (e: unknown) {
      // A superseded render was cancelled — let the newer one finish.
      if (e instanceof Error && /cancel/i.test(`${e.name} ${e.message}`)) return;
      throw e;
    }

    const layerEl = textLayerRef.current;
    if (layerEl) {
      selectionCleanupRef.current?.();
      selectionCleanupRef.current = null;
      currentTextLayerRef.current?.cancel();
      layerEl.replaceChildren();
      layerEl.style.setProperty('--scale-factor', String(viewport.scale));
      const textContentSource = p.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      const TextLayer = (pdfjsLib as unknown as { TextLayer: TextLayerCtor }).TextLayer;
      const tl = new TextLayer({
        textContentSource,
        container: layerEl,
        viewport,
      });
      currentTextLayerRef.current = tl;
      await tl.render();
      selectionCleanupRef.current = bindTextLayerSelection(layerEl);
      selectionLayerRef.current?.replaceChildren();
    }
    // The canvas is now rasterised at this zoom. Snap the transform back to 1
    // imperatively first, then update state — so React's re-render finds the DOM
    // already correct (new-size canvas, scale 1) and produces no visible step.
    pageContainerRef.current?.style.setProperty('transform', 'scale(1)');
    setRenderScale(zoom);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const arrayBuf = await getBookFile(book.id);
        if (cancelled || !arrayBuf) return;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        await renderPage(pdf, page);
      } catch (err) {
        console.error('Failed to load PDF:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      selectionCleanupRef.current?.();
      selectionCleanupRef.current = null;
      currentTextLayerRef.current?.cancel();
      pdfRef.current?.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    if (pdfRef.current) renderPage(pdfRef.current, page);
  }, [page, renderPage]);

  useEffect(() => {
    const pct = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
    updateBook({
      ...book,
      lastOpened: new Date().toISOString(),
      progress: pct,
      lastPosition: String(page),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, totalPages]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setPage((p) => Math.min(p + 1, totalPages));
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setPage((p) => Math.max(p - 1, 1));
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [totalPages]);

  // Paint our own selection highlight (native ::selection leaves word gaps).
  useEffect(() => {
    const layer = textLayerRef.current;
    const pageContainer = pageContainerRef.current;
    const selectionLayer = selectionLayerRef.current;
    if (!layer || !pageContainer || !selectionLayer) return;

    const paint = () => paintSelectionHighlight(layer, pageContainer, selectionLayer);
    const clear = () => selectionLayer.replaceChildren();

    layer.addEventListener('mousedown', clear);
    layer.addEventListener('mouseup', paint);
    document.addEventListener('selectionchange', paint);
    return () => {
      layer.removeEventListener('mousedown', clear);
      layer.removeEventListener('mouseup', paint);
      document.removeEventListener('selectionchange', paint);
    };
  }, []);

  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const raw = window.getSelection()?.toString() ?? '';
    if (!raw) return;
    const cleaned = raw
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/([^\n])\n([^\n])/g, '$1 $2');
    e.clipboardData.setData('text/plain', cleaned);
    e.preventDefault();
  }, []);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const zoomIn = () => setVisualZoom((z) => clampZoom(+(z + 0.25).toFixed(2)));
  const zoomOut = () => setVisualZoom((z) => clampZoom(+(z - 0.25).toFixed(2)));
  const fitWidth = () => setVisualZoom(1);

  // Ctrl + wheel: continuous zoom driven by deltaY (Figma/Maps feel).
  // preventDefault so the browser doesn't zoom the whole page.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setVisualZoom((z) => clampZoom(z - e.deltaY * 0.002));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-rasterize the canvas at the new zoom 300ms after the user stops zooming.
  useEffect(() => {
    if (visualZoom === renderScale) return;
    const id = setTimeout(() => {
      if (pdfRef.current) renderPage(pdfRef.current, pageRef.current);
    }, 300);
    return () => clearTimeout(id);
  }, [visualZoom, renderScale, renderPage]);

  const percentage = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
  const transformScale = visualZoom / renderScale;

  return (
    <>
      <ReaderToolbar chapter={`Page ${page}`} percentage={percentage} />
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          {loading && <div className={styles.loading}>Loading PDF...</div>}
          <div ref={canvasWrapRef} className={styles.canvasWrap}>
            <div
              ref={pageContainerRef}
              className={styles.pageContainer}
              style={{
                transform: `scale(${transformScale})`,
                transformOrigin: 'top center',
              }}
            >
              <canvas ref={canvasRef} />
              <div ref={selectionLayerRef} className={styles.selectionLayer} />
              <div
                ref={textLayerRef}
                className="textLayer"
                onCopy={handleCopy}
              />
            </div>
          </div>
          <div className={styles.pageNav}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
            >
              &larr; Prev
            </button>
            <span className={styles.pageInfo}>
              {page} / {totalPages}
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
            >
              Next &rarr;
            </button>
            <div className={styles.zoomGroup}>
              <button
                className={styles.pageBtn}
                onClick={zoomOut}
                disabled={visualZoom <= ZOOM_MIN}
                aria-label="Zoom out"
              >
                &minus;
              </button>
              <button className={styles.zoomLevel} onClick={fitWidth} title="Fit width">
                {Math.round(visualZoom * 100)}%
              </button>
              <button
                className={styles.pageBtn}
                onClick={zoomIn}
                disabled={visualZoom >= ZOOM_MAX}
                aria-label="Zoom in"
              >
                +
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
    </>
  );
}
