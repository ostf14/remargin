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

interface Props {
  book: Book;
}

export function PdfReader({ book }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const currentTextLayerRef = useRef<TextLayerInstance | null>(null);
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
    const canvas = canvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    console.log('[pdf] canvas size', canvas.width, canvas.height, 'inDOM=', document.body.contains(canvas));
    const canvasContext = canvas.getContext('2d')!;
    console.log('[pdf] ctx?', !!canvasContext, 'starting render');
    await p.render({ canvasContext, viewport }).promise;
    console.log('[pdf] render done for page', num);

    const layerEl = textLayerRef.current;
    if (layerEl) {
      currentTextLayerRef.current?.cancel();
      layerEl.replaceChildren();
      layerEl.style.width = `${viewport.width}px`;
      layerEl.style.height = `${viewport.height}px`;
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
              <div ref={textLayerRef} className={`${styles.textLayer} textLayer`} />
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
