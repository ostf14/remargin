import type { Book, Annotation, AppState } from '../types';

const BOOKS_KEY = 'remargin_books';
const APP_STATE_KEY = 'remargin_app_state';
const DB_NAME = 'remargin';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const ANNOTATIONS_STORE = 'annotations';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
      if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
        const store = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function loadBooks(): Book[] {
  try {
    const raw = localStorage.getItem(BOOKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBooks(books: Book[]): void {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
}

const DEFAULT_APP_STATE: AppState = {
  lastView: 'library',
  lastBookId: null,
  theme: 'dark',
  epubFontSizeOffset: 0,
  readingSurface: 'light',
  readerMode: 'pages',
  libraryView: 'grid',
};

export function loadAppState(): AppState {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    return raw ? { ...DEFAULT_APP_STATE, ...JSON.parse(raw) } : { ...DEFAULT_APP_STATE };
  } catch {
    return { ...DEFAULT_APP_STATE };
  }
}

export function saveAppState(state: AppState): void {
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
}

export function saveBookFile(bookId: string, data: ArrayBuffer): Promise<void> {
  return tx<IDBValidKey>(FILES_STORE, 'readwrite', (s) => s.put(data, bookId)).then(() => undefined);
}

export function getBookFile(bookId: string): Promise<ArrayBuffer | null> {
  return tx<ArrayBuffer | undefined>(FILES_STORE, 'readonly', (s) => s.get(bookId)).then(
    (v) => v ?? null,
  );
}

export function deleteBookFile(bookId: string): Promise<void> {
  return tx<undefined>(FILES_STORE, 'readwrite', (s) => s.delete(bookId)).then(() => undefined);
}

export function loadAnnotations(bookId?: string): Promise<Annotation[]> {
  return openDb().then(
    (db) =>
      new Promise<Annotation[]>((resolve, reject) => {
        const transaction = db.transaction(ANNOTATIONS_STORE, 'readonly');
        const store = transaction.objectStore(ANNOTATIONS_STORE);
        const req = bookId
          ? store.index('bookId').getAll(bookId)
          : store.getAll();
        req.onsuccess = () => resolve(req.result as Annotation[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function saveAnnotation(annotation: Annotation): Promise<void> {
  return tx<IDBValidKey>(ANNOTATIONS_STORE, 'readwrite', (s) => s.put(annotation)).then(
    () => undefined,
  );
}

export function deleteAnnotation(id: string): Promise<void> {
  return tx<undefined>(ANNOTATIONS_STORE, 'readwrite', (s) => s.delete(id)).then(() => undefined);
}

export function deleteAnnotationsForBook(bookId: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(ANNOTATIONS_STORE, 'readwrite');
        const store = transaction.objectStore(ANNOTATIONS_STORE);
        const req = store.index('bookId').openKeyCursor(IDBKeyRange.only(bookId));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}
