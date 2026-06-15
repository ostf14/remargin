import type { Book, Annotation } from '../types';

const BOOKS_KEY = 'remargin_books';
const DB_NAME = 'remargin';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const ANNOTATIONS_STORE = 'annotations';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  console.log('[storage] openDb called, cached?', !!dbPromise);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      console.log('[storage] openDb onupgradeneeded');
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
      if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
        const store = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = () => {
      console.log('[storage] openDb onsuccess, stores=', Array.from(req.result.objectStoreNames));
      resolve(req.result);
    };
    req.onerror = () => {
      console.error('[storage] openDb onerror', req.error);
      reject(req.error);
    };
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
    const result = raw ? JSON.parse(raw) : [];
    console.log('[storage] loadBooks ->', result.length, 'books');
    return result;
  } catch (err) {
    console.error('[storage] loadBooks failed', err);
    return [];
  }
}

export function saveBooks(books: Book[]): void {
  console.log('[storage] saveBooks', books.length, 'books');
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
}

export function saveBookFile(bookId: string, data: ArrayBuffer): Promise<void> {
  console.log('[storage] saveBookFile', bookId, 'bytes=', data?.byteLength);
  return tx<IDBValidKey>(FILES_STORE, 'readwrite', (s) => s.put(data, bookId))
    .then((key) => {
      console.log('[storage] saveBookFile OK key=', key);
    })
    .catch((err) => {
      console.error('[storage] saveBookFile FAILED', err);
      throw err;
    });
}

export function getBookFile(bookId: string): Promise<ArrayBuffer | null> {
  console.log('[storage] getBookFile', bookId);
  return tx<ArrayBuffer | undefined>(FILES_STORE, 'readonly', (s) => s.get(bookId))
    .then((v) => {
      console.log('[storage] getBookFile result for', bookId, 'bytes=', v?.byteLength ?? 'null', 'type=', v?.constructor?.name);
      return v ?? null;
    })
    .catch((err) => {
      console.error('[storage] getBookFile FAILED', err);
      throw err;
    });
}

export function deleteBookFile(bookId: string): Promise<void> {
  console.log('[storage] deleteBookFile', bookId);
  return tx<undefined>(FILES_STORE, 'readwrite', (s) => s.delete(bookId)).then(() => undefined);
}

export function loadAnnotations(bookId?: string): Promise<Annotation[]> {
  console.log('[storage] loadAnnotations', bookId);
  return openDb().then(
    (db) =>
      new Promise<Annotation[]>((resolve, reject) => {
        const transaction = db.transaction(ANNOTATIONS_STORE, 'readonly');
        const store = transaction.objectStore(ANNOTATIONS_STORE);
        const req = bookId
          ? store.index('bookId').getAll(bookId)
          : store.getAll();
        req.onsuccess = () => {
          console.log('[storage] loadAnnotations result', (req.result as Annotation[]).length);
          resolve(req.result as Annotation[]);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

export function saveAnnotation(annotation: Annotation): Promise<void> {
  console.log('[storage] saveAnnotation', annotation.id);
  return tx<IDBValidKey>(ANNOTATIONS_STORE, 'readwrite', (s) => s.put(annotation)).then(
    () => undefined,
  );
}

export function deleteAnnotation(id: string): Promise<void> {
  console.log('[storage] deleteAnnotation', id);
  return tx<undefined>(ANNOTATIONS_STORE, 'readwrite', (s) => s.delete(id)).then(() => undefined);
}
