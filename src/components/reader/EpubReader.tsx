import { useEffect, useRef, useState, useCallback } from 'react';
import ePub, { type Rendition, type Book as EpubBook } from 'epubjs';
import type { Book, EpubAnchor } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useAnnotations } from '../../hooks/useAnnotations';
import { useReader } from '../../hooks/useReader';
import { getBookFile } from '../../services/storage';
import { ReaderToolbar } from './ReaderToolbar';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import styles from './EpubReader.module.css';

interface Props {
  book: Book;
}

interface PopoverState {
  x: number;
  y: number;
  text: string;
  cfiRange: string;
  chapter: string;
}

export function EpubReader({ book }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { updateBook } = useLibrary();
  const { showAnnotations } = useReader();
  const { annotations, addAnnotation, updateAnnotation, deleteAnnotation } =
    useAnnotations(book.id);
  const [chapter, setChapter] = useState('');
  const [percentage, setPercentage] = useState(book.progress?.percentage ?? 0);
  const [loading, setLoading] = useState(true);
  const [popover, setPopover] = useState<PopoverState | null>(null);

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

      rendition.themes.default({
        body: {
          background: 'var(--bg-primary) !important',
          color: 'var(--text-primary) !important',
          'font-family': 'var(--font-serif) !important',
          'line-height': '1.8 !important',
          'padding': '0 2rem !important',
          '-webkit-user-select': 'text !important',
          'user-select': 'text !important',
        },
        'a': { color: 'var(--accent) !important' },
        '::selection': {
          background: 'rgba(232, 200, 73, 0.35) !important',
        },
      });

      const startCfi = book.progress?.location;
      if (startCfi) {
        rendition.display(startCfi);
      } else {
        rendition.display();
      }

      rendition.on('displayed', () => setLoading(false));

      const epubInstance = epub;
      rendition.on('relocated', (location: unknown) => {
        const loc = location as { start: { cfi: string; href: string; percentage: number } };
        const pct = Math.round((loc.start.percentage || 0) * 100);
        setPercentage(pct);

        updateBook({
          ...book,
          lastOpenedAt: new Date().toISOString(),
          progress: { location: loc.start.cfi, percentage: pct },
        });

        getCurrentChapter(epubInstance, loc.start.href).then((ch) => {
          if (ch) setChapter(ch);
        });
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
      if (a.anchor.type === 'epub') {
        try {
          rendition.annotations.remove(a.anchor.cfiRange, 'highlight');
        } catch { /* ignore */ }
        rendition.annotations.highlight(
          a.anchor.cfiRange,
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

  const handleHighlight = (color: 'yellow' | 'green' | 'blue' | 'pink' = 'yellow') => {
    if (!popover) return;
    const anchor: EpubAnchor = { type: 'epub', cfiRange: popover.cfiRange };
    addAnnotation(popover.text, anchor, popover.chapter, color);
    setPopover(null);
    renditionRef.current?.annotations.highlight(
      popover.cfiRange,
      {},
      () => {},
      'hl',
      { fill: `var(--highlight-${color})`, 'fill-opacity': '1', 'mix-blend-mode': 'multiply' },
    );
  };

  return (
    <>
      <ReaderToolbar chapter={chapter} percentage={percentage} />
      <div className={styles.wrapper}>
        <div className={styles.readerArea}>
          {loading && <div className={styles.loading}>Loading book...</div>}
          <div ref={viewerRef} className={styles.viewer} />
          <button
            className={`${styles.navBtn} ${styles.prev}`}
            onClick={() => renditionRef.current?.prev()}
          >
            &lsaquo;
          </button>
          <button
            className={`${styles.navBtn} ${styles.next}`}
            onClick={() => renditionRef.current?.next()}
          >
            &rsaquo;
          </button>
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
          onDismiss={() => setPopover(null)}
        />
      )}
    </>
  );
}
