import styles from './LibraryControls.module.css';

export type SortKey = 'recent' | 'added' | 'title' | 'author' | 'progress';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recently read' },
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'author', label: 'Author A–Z' },
  { value: 'progress', label: 'Progress' },
];

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  sort: SortKey;
  onSortChange: (v: SortKey) => void;
  countLabel: string;
}

export function LibraryControls({ query, onQueryChange, sort, onSortChange, countLabel }: Props) {
  return (
    <div className={styles.controls}>
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon} aria-hidden="true">⌕</span>
        <input
          className={styles.search}
          type="text"
          placeholder="Search books..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className={styles.clearInput}
            onClick={() => onQueryChange('')}
            title="Clear search"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className={styles.right}>
        <span className={styles.count}>{countLabel}</span>
        <select
          className={styles.sort}
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sort books"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
