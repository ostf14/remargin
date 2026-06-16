import { useEffect, useMemo, useState } from 'react';
import type { Book } from '../../types';
import { useLibrary } from '../../hooks/useLibrary';
import { useReader } from '../../hooks/useReader';
import { BookCard } from './BookCard';
import { ContinueReading } from './ContinueReading';
import { LibraryControls, type SortKey } from './LibraryControls';
import { ImportDropzone } from './ImportDropzone';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './BookGrid.module.css';

function timeOf(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

function matchesQuery(book: Book, needle: string): boolean {
  if (!needle) return true;
  return (
    book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle)
  );
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
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

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

  // Filter first, then sort — never mutate the context's books array.
  const visibleBooks = useMemo(
    () => books.filter((b) => matchesQuery(b, needle)).sort((a, b) => compareBooks(a, b, sort)),
    [books, needle, sort],
  );

  const searching = needle !== '';
  const countLabel = searching
    ? `${visibleBooks.length} of ${books.length} books`
    : `${books.length} ${books.length === 1 ? 'book' : 'books'}`;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>remargin</h1>
        </div>
        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <ImportDropzone />

      {books.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Your library is empty</div>
          <div className={styles.emptyHint}>Import an EPUB or PDF to get started</div>
        </div>
      ) : (
        <>
          {continueBook && (
            <ContinueReading book={continueBook} onContinue={() => openBook(continueBook)} />
          )}

          <LibraryControls
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onSortChange={setSort}
            countLabel={countLabel}
          />

          {visibleBooks.length === 0 ? (
            <div className={styles.noResults}>
              <div className={styles.emptyTitle}>No books found</div>
              <div className={styles.emptyHint}>Nothing matches “{debouncedQuery.trim()}”.</div>
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
        </>
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
