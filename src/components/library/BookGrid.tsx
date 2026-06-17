import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Sun, Moon, BookOpen, ChevronDown } from 'lucide-react';
import type { Book } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useReader } from '../../hooks/useReader';
import { useImport } from '../../hooks/useImport';
import { BookCard } from './BookCard';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './BookGrid.module.css';

type SortKey = 'recent' | 'added' | 'title' | 'author' | 'progress';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recently read' },
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'author', label: 'Author A–Z' },
  { value: 'progress', label: 'Progress' },
];

function timeOf(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

function matchesQuery(book: Book, needle: string): boolean {
  if (!needle) return true;
  return book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle);
}

function compareBooks(a: Book, b: Book, sort: SortKey): number {
  switch (sort) {
    case 'recent':
      return timeOf(b.lastOpened) - timeOf(a.lastOpened);
    case 'added':
      return timeOf(b.addedAt) - timeOf(a.addedAt);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author':
      return a.author.localeCompare(b.author);
    case 'progress':
      return (b.progress ?? 0) - (a.progress ?? 0);
  }
}

export function BookGrid() {
  const { books, removeBook, updateBook, enrichingIds } = useLibrary();
  const { openBook, theme, toggleTheme } = useReader();
  const { importFiles } = useImport();
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search input so filtering doesn't churn on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Close the sort dropdown on any outside click.
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [sortOpen]);

  // Most-recently-opened book — becomes the big "Continue reading" hero card.
  const continueBook = useMemo(() => {
    let latest: Book | null = null;
    for (const b of books) {
      if (!b.lastOpened) continue;
      if (!latest || timeOf(b.lastOpened) > timeOf(latest.lastOpened)) latest = b;
    }
    return latest;
  }, [books]);

  const needle = debouncedQuery.trim().toLowerCase();
  const visibleBooks = useMemo(
    () => books.filter((b) => matchesQuery(b, needle)).sort((a, b) => compareBooks(a, b, sort)),
    [books, needle, sort],
  );

  const searching = needle !== '';
  // The hero overlay shows only when the first card actually is the continue book
  // (true by default — 'recent' sort puts it first — and suppressed while searching).
  const heroId = !searching && continueBook ? continueBook.id : null;

  const countLabel = searching
    ? `${visibleBooks.length} of ${books.length}`
    : `${books.length} ${books.length === 1 ? 'book' : 'books'}`;

  const openPicker = () => fileInputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) importFiles(e.target.files);
    e.target.value = '';
  };

  const hasBooks = books.length > 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.logo}>remargin</h1>

        <div className={styles.actions}>
          {hasBooks && (
            <div className={styles.searchWrap}>
              <Search className={styles.searchIcon} size={14} aria-hidden="true" />
              <input
                className={styles.search}
                type="text"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {hasBooks && <span className={styles.count}>{countLabel}</span>}
          {hasBooks && (
            <div className={styles.sortWrap} ref={sortRef}>
              <button
                className={styles.sortBtn}
                onClick={() => setSortOpen((o) => !o)}
                aria-label="Sort books"
              >
                {SORT_OPTIONS.find((o) => o.value === sort)?.label}
                <ChevronDown size={12} />
              </button>
              {sortOpen && (
                <div className={styles.sortMenu}>
                  {SORT_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      className={`${styles.sortOption} ${o.value === sort ? styles.sortOptionActive : ''}`}
                      onClick={() => {
                        setSort(o.value);
                        setSortOpen(false);
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            className={styles.importBtn}
            onClick={openPicker}
            title="Import book"
            aria-label="Import book"
          >
            <Plus size={16} />
          </button>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf"
        multiple
        hidden
        onChange={onFileChange}
      />

      {!hasBooks ? (
        <div className={styles.empty}>
          <BookOpen className={styles.emptyIcon} size={32} aria-hidden="true" />
          <div className={styles.emptyTitle}>Your library is empty</div>
          <div className={styles.emptyHint}>Drop a book or click + to start</div>
          <button className={styles.emptyBtn} onClick={openPicker}>
            Import
          </button>
        </div>
      ) : visibleBooks.length === 0 ? (
        <div className={styles.noResults}>
          <div className={styles.noResultsTitle}>No books found</div>
          <div className={styles.noResultsHint}>Nothing matches “{debouncedQuery.trim()}”.</div>
          <button className={styles.clearBtn} onClick={() => setQuery('')}>
            Clear search
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleBooks.map((book, i) => (
            <BookCard
              key={book.id}
              book={book}
              featured={i === 0 && book.id === heroId}
              enriching={enrichingIds.has(book.id)}
              onClick={() => openBook(book)}
              onRemove={() => setPendingDelete(book)}
              onUpdate={updateBook}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete book?"
          message={`"${pendingDelete.title}" and all its annotations will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            removeBook(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
