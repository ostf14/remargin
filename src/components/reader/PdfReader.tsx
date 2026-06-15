import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
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

// pdf.js renders one absolutely-positioned <span> per text chunk with gaps
// between them, so a drag-selection paints disjoint boxes. Stretch each span
// rightward to the next span's left edge to close those gaps.
// Robust to pdf.js positioning: spans use percentage left/top and a CSS
// transform (scaleX/scale/rotate), so we measure with getBoundingClientRect
// (post-transform px) and derive the effective horizontal scale as
// renderedWidth / offsetWidth to convert a rendered gap back into a layout width.
function expandTextLayerSpans(container: HTMLElement) {
  const spans = Array.from(
    container.querySelectorAll<HTMLSpanElement>('span:not(.markedContent)'),
  );
  // Snapshot geometry first (reads), then mutate (writes) — avoids layout thrash.
  const items = spans
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        el,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        height: rect.height,
        renderedWidth: rect.width,
        layoutWidth: el.offsetWidth,
      };
    })
    .filter((it) => it.renderedWidth > 0 && it.layoutWidth > 0);
  if (items.length < 2) return;

  // Group spans into lines by vertical position.
  items.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: (typeof items)[] = [];
  for (const it of items) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(it.top - line[0].top) <= Math.max(it.height, line[0].height) * 0.5) {
      line.push(it);
    } else {
      lines.push([it]);
    }
  }

  for (const line of lines) {
    line.sort((a, b) => a.left - b.left);
    for (let i = 0; i < line.length - 1; i++) {
      const cur = line[i];
      const next = line[i + 1];
      if (next.left <= cur.right) continue; // already touching / overlapping
      const scaleX = cur.renderedWidth / cur.layoutWidth;
      if (scaleX <= 0) continue;
      const newLayoutWidth = (next.left - cur.left) / scaleX;
      cur.el.style.width = `${newLayoutWidth}px`;
    }
  }
}

interface Props {
  book: Book;
}

export function PdfReader({ book }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const currentTextLayerRef = useRef<TextLayerInstance | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const { updateBook } = useLibrary();
  const { showAnnotations } = useReader();
  const { annotations, updateAnnotation, deleteAnnotation } = useAnnotations(book.id);
  const [page, setPage] = useState(Number(book.progress?.location) || 1);
  const [totalPages, setTotalPages] = useState(book.totalPages || 0);
  const [loading, setLoading] = useState(true);

  const renderPage = useCallback(async (pdf: PDFDocumentProxy, num: number) => {
    console.log('[pdf] renderPage num=', num, 'canvasRef?', !!canvasRef.current);
    if (!canvasRef.current) {
      console.warn('[pdf] renderPage abort: no canvas');
      return;
    }
    const p = await pdf.getPage(num);
    const viewport = p.getViewport({ scale: 1.5 });
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.floor(viewport.width);
    const cssHeight = Math.floor(viewport.height);

    const canvas = canvasRef.current;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    console.log('[pdf] canvas bitmap', canvas.width, canvas.height, 'css', cssWidth, cssHeight, 'dpr', dpr);

    const canvasContext = canvas.getContext('2d')!;
    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
    console.log('[pdf] starting render, transform=', transform);
    await p.render({ canvasContext, viewport, transform }).promise;
    console.log('[pdf] render done for page', num);

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
      expandTextLayerSpans(layerEl);
      console.log('[pdf] textLayer rendered for page', num);
    }
  }, []);

  useEffect(() => {
    console.log('[pdf] effect mount, book.id=', book.id, 'progress.location=', book.progress?.location);
    let cancelled = false;
    (async () => {
      try {
        const arrayBuf = await getBookFile(book.id);
        console.log('[pdf] got arrayBuf from idb, bytes=', arrayBuf?.byteLength, 'type=', arrayBuf?.constructor?.name);
        if (cancelled) { console.log('[pdf] cancelled after getBookFile'); return; }
        if (!arrayBuf) { console.error('[pdf] arrayBuf is null/empty — file missing from IndexedDB'); return; }
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        console.log('[pdf] doc loaded, numPages=', pdf.numPages);
        if (cancelled) return;
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        await renderPage(pdf, page);
      } catch (err) {
        console.error('[pdf] PDF load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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
      lastOpenedAt: new Date().toISOString(),
      progress: { location: String(page), percentage: pct },
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

  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const raw = window.getSelection()?.toString() ?? '';
    if (!raw) return;
    const cleaned = raw
      .replace(/(\w)-\n(\w)/g, '$1$2')
      .replace(/([^\n])\n([^\n])/g, '$1 $2');
    e.clipboardData.setData('text/plain', cleaned);
    e.preventDefault();
  }, []);

  const percentage = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;

  return (
    <>
      <ReaderToolbar chapter={`Page ${page}`} percentage={percentage} />
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          {loading && <div className={styles.loading}>Loading PDF...</div>}
          <div className={styles.canvasWrap}>
            <div className={styles.pageContainer}>
              <canvas ref={canvasRef} />
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
