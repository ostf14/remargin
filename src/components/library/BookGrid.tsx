import { useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useReader } from '../../hooks/useReader';
import { useImport } from '../../hooks/useImport';
import { BookCard } from './BookCard';
import { ContinueReading } from './ContinueReading';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search input so filtering doesn't churn on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Most-recently-opened book powers the "Continue reading" hero (null if none opened yet).
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
  const countLabel = searching
    ? `${visibleBooks.length} of ${books.length} books`
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

        {hasBooks && (
          <div className={styles.searchArea}>
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon} aria-hidden="true">⌕</span>
              <input
                className={styles.search}
                type="text"
                placeholder="Search books..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className={styles.clearInput}
                  onClick={() => setQuery('')}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        <div className={styles.actions}>
          {hasBooks && <span className={styles.count}>{countLabel}</span>}
          {hasBooks && (
            <select
              className={styles.sort}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort books"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button
            className={styles.importBtn}
            onClick={openPicker}
            title="Import book"
            aria-label="Import book"
          >
            +
          </button>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
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
          <div className={styles.emptyIcon}>📚</div>
          <div className={styles.emptyTitle}>Your library is empty</div>
          <div className={styles.emptyHint}>Drop a book here or click + to start reading</div>
          <button className={styles.emptyBtn} onClick={openPicker}>
            Import Book
          </button>
        </div>
      ) : (
        <div className={styles.body}>
          {continueBook && (
            <ContinueReading book={continueBook} onContinue={() => openBook(continueBook)} />
          )}

          {visibleBooks.length === 0 ? (
            <div className={styles.noResults}>
              <div className={styles.noResultsTitle}>No books found</div>
              <div className={styles.noResultsHint}>Nothing matches “{debouncedQuery.trim()}”.</div>
              <button className={styles.clearBtn} onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          ) : (
            <div className={styles.grid}>
              {visibleBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  enriching={enrichingIds.has(book.id)}
                  onClick={() => openBook(book)}
                  onRemove={() => setPendingDelete(book)}
                  onUpdate={updateBook}
                />
              ))}
            </div>
          )}
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
