import { useEffect, useMemo, useState } from 'react';
import { Search, Highlighter, ChevronDown, ChevronUp, FileDown, Download } from 'lucide-react';
import type { Annotation } from '../../types';
import { loadAnnotations } from '../../services/storage';
import { useLibrary } from '../../hooks/useLibrary';
import { useReader } from '../../hooks/useReader';
import {
  exportSingleAnnotation,
  exportAllAnnotations,
  exportAllBooks,
} from '../../services/exportMarkdown';
import styles from './NotesView.module.css';

// Solid highlight colours (same palette as the highlight popover), for the card color bar.
const COLOR_MAP: Record<string, string> = {
  yellow: '#ffd43b',
  green: '#69db7c',
  blue: '#74c0fc',
  red: '#ff8787',
  purple: '#da77f2',
};

function anchorLabel(a: Annotation): string {
  return a.anchor.kind === 'epub' ? a.anchor.chapter : `Page ${a.anchor.page}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Order within a book by position in the text: PDF by page then vertical offset; EPUB
// chronologically (a good proxy for reading order without a live CFI comparator).
function byPosition(a: Annotation, b: Annotation): number {
  if (a.anchor.kind === 'pdf' && b.anchor.kind === 'pdf') {
    const pa = a.anchor.page * 1e6 + (a.anchor.rects[0]?.y ?? 0);
    const pb = b.anchor.page * 1e6 + (b.anchor.rects[0]?.y ?? 0);
    return pa - pb;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

// Cross-book annotation dashboard. Reads every annotation straight from storage; groups
// them by book (most-recently-annotated first, collapsible) and jumps to the highlight on
// click. Export at three levels: one note (.md), one book (.zip), the whole library (.zip).
export function NotesView() {
  const { books } = useLibrary();
  const { openBook } = useReader();
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set()); // empty = all open

  useEffect(() => {
    let cancelled = false;
    loadAnnotations().then((list) => {
      if (!cancelled) setAnnotations(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const all = useMemo(
    () => (annotations ?? []).filter((a) => bookMap.has(a.bookId)),
    [annotations, bookMap],
  );

  // Stats reflect the whole library, not the current search.
  const stats = useMemo(
    () => ({
      highlights: all.length,
      notes: all.filter((a) => a.note.trim()).length,
      books: new Set(all.map((a) => a.bookId)).size,
    }),
    [all],
  );

  // Group the (search-filtered) annotations by book, newest-annotated book first.
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matches = needle
      ? all.filter(
          (a) =>
            a.highlightedText.toLowerCase().includes(needle) ||
            a.note.toLowerCase().includes(needle),
        )
      : all;

    const byBook = new Map<string, Annotation[]>();
    for (const a of matches) {
      const arr = byBook.get(a.bookId);
      if (arr) arr.push(a);
      else byBook.set(a.bookId, [a]);
    }

    return [...byBook.entries()]
      .map(([bookId, anns]) => ({
        book: bookMap.get(bookId)!,
        anns: [...anns].sort(byPosition),
        lastAt: anns.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), ''),
      }))
      .sort((x, y) => (x.lastAt < y.lastAt ? 1 : x.lastAt > y.lastAt ? -1 : 0));
  }, [all, needle, bookMap]);

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportEverything = () => {
    const byBook = new Map<string, Annotation[]>();
    for (const a of all) {
      const arr = byBook.get(a.bookId);
      if (arr) arr.push(a);
      else byBook.set(a.bookId, [a]);
    }
    void exportAllBooks(
      [...byBook.entries()].map(([id, anns]) => ({
        book: bookMap.get(id)!,
        annotations: [...anns].sort(byPosition),
      })),
    );
  };

  if (annotations === null) return <div className={styles.container} />;

  if (all.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <Highlighter className={styles.emptyIcon} size={32} aria-hidden="true" />
          <div className={styles.emptyTitle}>No annotations yet</div>
          <div className={styles.emptyHint}>Highlight text while reading to see it here</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.highlights}</div>
          <div className={styles.statLabel}>Highlights</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.notes}</div>
          <div className={styles.statLabel}>Notes</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.books}</div>
          <div className={styles.statLabel}>Books</div>
        </div>
        <button className={styles.exportAll} onClick={exportEverything}>
          Export all
        </button>
      </div>

      <div className={styles.searchWrap}>
        <Search className={styles.searchIcon} size={14} aria-hidden="true" />
        <input
          className={styles.search}
          type="text"
          placeholder="Search all annotations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {groups.length === 0 ? (
        <div className={styles.noResults}>Nothing matches “{query.trim()}”.</div>
      ) : (
        groups.map(({ book, anns }) => {
          const isCollapsed = collapsed.has(book.id);
          return (
            <div key={book.id} className={styles.group}>
              <div
                className={styles.bookHeader}
                onClick={() => toggleCollapse(book.id)}
                role="button"
                tabIndex={0}
              >
                {isCollapsed ? (
                  <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />
                ) : (
                  <ChevronUp className={styles.chevron} size={14} aria-hidden="true" />
                )}
                {book.coverUrl ? (
                  <img className={styles.thumb} src={book.coverUrl} alt="" />
                ) : (
                  <div className={styles.thumbPlaceholder} />
                )}
                <div className={styles.bookTitle}>{book.title}</div>
                <button
                  className={styles.bookExport}
                  onClick={(e) => {
                    e.stopPropagation();
                    void exportAllAnnotations(book, anns);
                  }}
                  title="Export this book’s annotations (.zip)"
                  aria-label="Export book annotations"
                >
                  <FileDown size={14} />
                </button>
                <span className={styles.countBadge}>{anns.length}</span>
              </div>

              {!isCollapsed &&
                anns.map((a) => (
                  <div
                    key={a.id}
                    className={styles.card}
                    onClick={() => openBook(book, a.anchor)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={styles.colorBar} style={{ background: COLOR_MAP[a.color] }} />
                    <div className={styles.content}>
                      <div className={styles.quote}>{a.highlightedText}</div>
                      {a.note.trim() && <div className={styles.comment}>{a.note}</div>}
                      <div className={styles.footer}>
                        <span className={styles.footMeta}>
                          {anchorLabel(a)} · {formatDate(a.createdAt)}
                        </span>
                        <button
                          className={styles.noteExport}
                          onClick={(e) => {
                            e.stopPropagation();
                            exportSingleAnnotation(book, a);
                          }}
                          title="Export note (.md)"
                          aria-label="Export note"
                        >
                          <Download size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          );
        })
      )}
    </div>
  );
}
