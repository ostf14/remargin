import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Book, HighlightColor } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
import { getBookFile } from '../../services/storage';
import { ReaderToolbar } from './ReaderToolbar';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { MarginNotes, type PositionedNote } from '../annotations/MarginNotes';
import { Toast } from './Toast';
import { formatCitation } from '../../services/citation';
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

type LineRect = { left: number; top: number; right: number; bottom: number };

// pdf.js text spans are transparent and only exist so the browser can build a
// Selection/Range. Native ::selection paints each absolutely-positioned span
// separately, leaving gaps between words — so we collect range.getClientRects()
// and merge same-line rects into one continuous band, in pageContainer-relative
// coordinates. Reused for both the live selection layer and saving a highlight.
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
  if (!raw.length) return [];

  // Merge vertically-overlapping rects into one continuous band per line.
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

function paintSelectionHighlight(
  textLayer: HTMLElement,
  pageContainer: HTMLElement,
  selectionLayer: HTMLElement,
) {
  selectionLayer.replaceChildren();
  for (const line of computeSelectionLineRects(textLayer, pageContainer)) {
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

// Text-zone top padding (CSS) — the vertical offset of the canvas (and thus the
// first page row) from the top of the page sheet. Margin cards share this origin.
const PAGE_PAD_TOP = 24;

export function PdfReader({ book }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const selectionLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const currentTextLayerRef = useRef<TextLayerInstance | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  // Fit-width scale (page-point → CSS px at 100% zoom). Changes only with the
  // container width / page size; the visual zoom is a CSS transform on top. Saved
  // highlight rects and note anchors are stored in page coords × this base scale.
  const baseScaleRef = useRef(1);
  const lastRenderedPageRef = useRef(0);
  const { updateBook } = useLibrary();
  const { showAnnotations } = useReader();
  const { annotations, addAnnotation, updateAnnotation, deleteAnnotation } = useAnnotations(book.id);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [page, setPage] = useState(Number(book.lastPosition) || 1);
  const [totalPages, setTotalPages] = useState(book.totalPages || 0);
  const [loading, setLoading] = useState(true);
  const [selPopover, setSelPopover] = useState<{ x: number; y: number } | null>(null);
  const [savedPopover, setSavedPopover] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  const [notePositions, setNotePositions] = useState<PositionedNote[]>([]);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const autoFocusIdRef = useRef<string | null>(null);
  autoFocusIdRef.current = autoFocusId;
  // Visual zoom = a CSS transform on the page sheet (canvas keeps its fit-width
  // CSS size; only its bitmap is re-rasterised, debounced, for sharpness).
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const renderedZoomRef = useRef(1); // zoom the current bitmap was rasterised at
  const pageRef = useRef(page);
  pageRef.current = page;

  // Transient "Copied citation" toast.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1500);
  }, []);
  // Keydown handler is registered once but must see fresh state — bridge via a ref.
  const shortcutKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // Draw all saved highlights for a page into the highlight layer, in the canvas's
  // fit-width CSS coords (× baseScale). The page's CSS zoom transform scales them
  // together with the canvas, so highlights track it without recomputation.
  const paintSavedHighlights = useCallback((pageNum: number) => {
    const layer = highlightLayerRef.current;
    if (!layer) return;
    layer.replaceChildren();
    const scale = baseScaleRef.current;
    for (const a of annotationsRef.current) {
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
        layer.append(div);
      }
    }
  }, []);

  // Position margin-note cards opposite their highlight. A note is shown when it
  // has text, or when it's the freshly created one being focused. Vertical anchor
  // = page-container top (accounts for scroll) + rect.y × scale, in reader coords.
  const recomputeNotePositions = useCallback(() => {
    const scale = baseScaleRef.current || 1;
    const result: PositionedNote[] = [];
    for (const a of annotationsRef.current) {
      if (a.anchor.kind !== 'pdf' || a.anchor.page !== pageRef.current) continue;
      if (a.note.trim() === '' && a.id !== autoFocusIdRef.current) continue;
      const first = a.anchor.rects[0];
      if (!first) continue;
      // Anchor × baseScale only — never × zoom. The page's CSS transform supplies
      // the zoom, so positions are stable across zooming (no jump, no recompute).
      result.push({
        id: a.id,
        anchorTop: PAGE_PAD_TOP + first.y * scale,
        note: a.note,
        color: a.color,
      });
    }
    setNotePositions(result);
  }, []);

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, num: number) => {
    if (!canvasRef.current) return;
    // Cancel any in-flight render so rapid zoom/page changes can't collide on the canvas.
    renderTaskRef.current?.cancel();

    const p = await pdf.getPage(num);

    // Fit-width base scale targets a comfortable text width (the page's text zone),
    // leaving room for the notes margin so the whole sheet stays ~900px at 100%.
    const unscaled = p.getViewport({ scale: 1 });
    let baseScale = 1;
    const wrap = canvasWrapRef.current;
    if (wrap) {
      const cs = getComputedStyle(wrap);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const deskInner = wrap.clientWidth - padX;
      const NOTES_W = 250;
      const TEXT_PAD = 32 + 16; // text zone left + right padding
      const PAGE_MAX = 900; // keep in sync with --page-max-width
      // Fit the canvas inside the (capped) page width so the sheet stays ~900px,
      // matching the EPUB page exactly.
      const pageWidth = Math.min(deskInner, PAGE_MAX);
      const targetText = Math.max(320, pageWidth - NOTES_W - TEXT_PAD - 8);
      if (targetText > 0) baseScale = targetText / unscaled.width;
    }
    const baseChanged = baseScale !== baseScaleRef.current;
    const pageChanged = num !== lastRenderedPageRef.current;
    baseScaleRef.current = baseScale;
    lastRenderedPageRef.current = num;

    const zoom = zoomRef.current;
    const baseViewport = p.getViewport({ scale: baseScale });
    const renderViewport = p.getViewport({ scale: baseScale * zoom });
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.floor(baseViewport.width);
    const cssHeight = Math.floor(baseViewport.height);

    // Rasterise at base × zoom (sharp), but display at the fit-width CSS size — the
    // page's CSS transform supplies the visual zoom. Offscreen avoids a clear-flash.
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.floor(renderViewport.width * dpr);
    offscreen.height = Math.floor(renderViewport.height * dpr);
    const offCtx = offscreen.getContext('2d')!;
    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
    const task = p.render({ canvasContext: offCtx, viewport: renderViewport, transform });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (e: unknown) {
      // A superseded render was cancelled — let the newer one finish.
      if (e instanceof Error && /cancel/i.test(`${e.name} ${e.message}`)) return;
      throw e;
    }

    requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.getContext('2d')!.drawImage(offscreen, 0, 0);
      renderedZoomRef.current = zoom;
      paintSavedHighlights(num);
      // Notes move only when the page or the fit-width scale changes — never on zoom.
      if (baseChanged || pageChanged) recomputeNotePositions();

      // Rebuild the transparent text layer at the fit-width scale (it rides the
      // same CSS zoom transform as the canvas). Its brief mis-scale is invisible.
      const layerEl = textLayerRef.current;
      if (!layerEl) return;
      selectionCleanupRef.current?.();
      selectionCleanupRef.current = null;
      currentTextLayerRef.current?.cancel();
      layerEl.replaceChildren();
      layerEl.style.setProperty('--scale-factor', String(baseScale));
      const textContentSource = p.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      const TextLayer = (pdfjsLib as unknown as { TextLayer: TextLayerCtor }).TextLayer;
      const tl = new TextLayer({ textContentSource, container: layerEl, viewport: baseViewport });
      currentTextLayerRef.current = tl;
      tl.render()
        .then(() => {
          if (currentTextLayerRef.current !== tl) return; // superseded by a newer render
          selectionCleanupRef.current = bindTextLayerSelection(layerEl);
          selectionLayerRef.current?.replaceChildren();
        })
        .catch(() => {
          /* cancelled by a newer render */
        });
    });
  }, [paintSavedHighlights, recomputeNotePositions]);

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

  // Selection shortcuts (citation copy, number-key highlights) — registered once,
  // delegating to the latest closure via ref. Clears the toast timer on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutKeyRef.current(e);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Paint our own selection highlight (native ::selection leaves word gaps),
  // and raise the create-highlight popover once a selection settles.
  useEffect(() => {
    const layer = textLayerRef.current;
    const pageContainer = pageContainerRef.current;
    const selectionLayer = selectionLayerRef.current;
    if (!layer || !pageContainer || !selectionLayer) return;

    const paint = () => paintSelectionHighlight(layer, pageContainer, selectionLayer);
    const onMouseDown = () => {
      selectionLayer.replaceChildren();
      setSelPopover(null);
      setSavedPopover(null);
    };
    const onMouseUp = () => {
      paint();
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim()) {
        const range = sel.getRangeAt(0);
        if (range.intersectsNode(layer)) {
          const r = range.getBoundingClientRect();
          setSelPopover({ x: r.left + r.width / 2, y: r.top });
        }
      }
    };

    layer.addEventListener('mousedown', onMouseDown);
    layer.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', paint);
    return () => {
      layer.removeEventListener('mousedown', onMouseDown);
      layer.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', paint);
    };
  }, []);

  // Repaint saved highlights whenever the annotation set changes (add/recolor/delete).
  useEffect(() => {
    paintSavedHighlights(pageRef.current);
  }, [annotations, paintSavedHighlights]);

  // Notes are positioned from stored anchor coordinates, relative to the page
  // sheet — they scroll and zoom with it (same parent transform), so the only
  // recompute triggers are an annotation change here and a page/zoom re-render
  // (done from the render rAF). No scroll/resize listeners needed.
  useEffect(() => {
    recomputeNotePositions();
  }, [annotations, autoFocusId, recomputeNotePositions]);

  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const raw = window.getSelection()?.toString() ?? '';
    if (!raw) return;
    const cleaned = raw
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/([^\n])\n([^\n])/g, '$1 $2');
    e.clipboardData.setData('text/plain', cleaned);
    e.preventDefault();
  }, []);

  // Persist the current selection as a highlight. Rects are stored in page
  // coordinates (relative px ÷ current scale) so they survive zoom/re-render.
  const handleCreateHighlight = (color: HighlightColor) => {
    const layer = textLayerRef.current;
    const pageContainer = pageContainerRef.current;
    const text = document.getSelection()?.toString().trim() ?? '';
    if (!layer || !pageContainer || !text) {
      setSelPopover(null);
      return;
    }
    const lines = computeSelectionLineRects(layer, pageContainer);
    const scale = baseScaleRef.current * zoomRef.current || 1;
    const rects = lines.map((l) => ({
      x: l.left / scale,
      y: l.top / scale,
      width: (l.right - l.left) / scale,
      height: (l.bottom - l.top) / scale,
    }));
    if (rects.length) {
      addAnnotation(text, { kind: 'pdf', page: pageRef.current, rects }, color);
    }
    document.getSelection()?.removeAllRanges();
    selectionLayerRef.current?.replaceChildren();
    setSelPopover(null);
  };

  // Clicking (not dragging) over a saved highlight opens its options popover.
  const handlePageClick = (e: React.MouseEvent) => {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return; // an active selection — not a click
    const pageContainer = pageContainerRef.current;
    if (!pageContainer) return;
    const base = pageContainer.getBoundingClientRect();
    const scale = baseScaleRef.current * zoomRef.current || 1;
    const px = (e.clientX - base.left) / scale;
    const py = (e.clientY - base.top) / scale;
    for (const a of annotationsRef.current) {
      if (a.anchor.kind !== 'pdf' || a.anchor.page !== pageRef.current) continue;
      const hit = a.anchor.rects.some(
        (r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height,
      );
      if (hit) {
        setSelPopover(null);
        setSavedPopover({ x: e.clientX, y: e.clientY, id: a.id });
        return;
      }
    }
  };

  // "Note" in the create popover: persist a highlight and open its margin card.
  const handleCreateNote = () => {
    const layer = textLayerRef.current;
    const pageContainer = pageContainerRef.current;
    const text = document.getSelection()?.toString().trim() ?? '';
    if (!layer || !pageContainer || !text) {
      setSelPopover(null);
      return;
    }
    const lines = computeSelectionLineRects(layer, pageContainer);
    const scale = baseScaleRef.current * zoomRef.current || 1;
    const rects = lines.map((l) => ({
      x: l.left / scale,
      y: l.top / scale,
      width: (l.right - l.left) / scale,
      height: (l.bottom - l.top) / scale,
    }));
    if (!rects.length) {
      setSelPopover(null);
      return;
    }
    const ann = addAnnotation(text, { kind: 'pdf', page: pageRef.current, rects }, 'yellow');
    document.getSelection()?.removeAllRanges();
    selectionLayerRef.current?.replaceChildren();
    setSelPopover(null);
    if (ann) setAutoFocusId(ann.id);
  };

  const handleSaveNote = (id: string, text: string) => {
    updateAnnotation(id, { note: text });
    if (autoFocusId === id) setAutoFocusId(null);
  };

  // Keyboard shortcuts over the current text selection. Ignored while typing in a
  // note field. Ctrl/Cmd+Shift+C copies a formatted citation (plain Ctrl+C is
  // handled separately by onCopy, keeping its newline cleanup).
  const handleShortcutKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    const raw = document.getSelection()?.toString() ?? '';
    if (!raw.trim()) return;

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      const citation = formatCitation(raw, book, `с. ${pageRef.current}`);
      navigator.clipboard
        .writeText(citation)
        .then(() => showToast('Copied citation'))
        .catch(() => {});
    }
  };
  shortcutKeyRef.current = handleShortcutKey;

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const zoomIn = () => setZoom((z) => clampZoom(+(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => clampZoom(+(z - 0.25).toFixed(2)));
  const fitWidth = () => setZoom(1);

  // Ctrl + wheel: continuous zoom (preventDefault blocks the browser's page zoom).
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.002));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-rasterise the bitmap sharper 250ms after zooming stops. The canvas CSS size
  // and the page transform don't change — only a crisper image swaps in, no jump.
  useEffect(() => {
    if (zoom === renderedZoomRef.current) return;
    const id = setTimeout(() => {
      if (pdfRef.current) renderPage(pdfRef.current, pageRef.current);
    }, 250);
    return () => clearTimeout(id);
  }, [zoom, renderPage]);

  // Re-fit (and re-anchor notes) when the window / desk width changes.
  useEffect(() => {
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (pdfRef.current) renderPage(pdfRef.current, pageRef.current);
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [renderPage]);

  const percentage = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;

  return (
    <>
      <ReaderToolbar chapter={`Page ${page}`} percentage={percentage} />
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          {loading && <div className={styles.loading}>Loading PDF...</div>}
          <div ref={canvasWrapRef} className={styles.canvasWrap}>
            <div
              className={styles.page}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
              }}
            >
              <div className={styles.textZone}>
                <div
                  ref={pageContainerRef}
                  className={styles.pageContainer}
                  onClick={handlePageClick}
                >
                  <canvas ref={canvasRef} />
                  <div ref={highlightLayerRef} className={styles.highlightLayer} />
                  <div ref={selectionLayerRef} className={styles.selectionLayer} />
                  <div
                    ref={textLayerRef}
                    className="textLayer"
                    onCopy={handleCopy}
                  />
                </div>
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
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
              >
                &minus;
              </button>
              <button className={styles.zoomLevel} onClick={fitWidth} title="Fit width">
                {Math.round(zoom * 100)}%
              </button>
              <button
                className={styles.pageBtn}
                onClick={zoomIn}
                disabled={zoom >= ZOOM_MAX}
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

      {selPopover && (
        <HighlightPopover
          x={selPopover.x}
          y={selPopover.y}
          onHighlight={handleCreateHighlight}
          onNote={handleCreateNote}
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
          onNote={() => {
            setAutoFocusId(savedPopover.id);
            setSavedPopover(null);
          }}
          noteLabel={
            annotations.find((a) => a.id === savedPopover.id)?.note.trim()
              ? 'Edit note'
              : 'Note'
          }
          onDelete={() => {
            deleteAnnotation(savedPopover.id);
            setSavedPopover(null);
          }}
          onDismiss={() => setSavedPopover(null)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
