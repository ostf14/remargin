export type BookFormat = 'epub' | 'pdf';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';

export type ViewMode = 'library' | 'reader';

export type ReadingSurface = 'light' | 'sepia' | 'dark';

export type ReaderMode = 'pages' | 'scroll' | 'flip';

export type LibraryView = 'grid' | 'notes';

export interface EpubAnchor {
  kind: 'epub';
  cfi: string;
  chapter: string;
}

export interface PdfAnchor {
  kind: 'pdf';
  page: number;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export type AnchorData = EpubAnchor | PdfAnchor;

export interface Annotation {
  id: string;
  bookId: string;
  type: 'highlight' | 'note';
  anchor: AnchorData;
  highlightedText: string;
  note: string;
  color: HighlightColor;
  createdAt: string;
  updatedAt: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  format: BookFormat;
  tags: string[];
  progress: number; // 0-100
  lastPosition: string | null; // CFI (epub) or page number string (pdf)
  lastOpened: string | null; // ISO date
  addedAt: string; // ISO date
  totalPages?: number; // pdf page count, used for progress math
  wordCount?: number; // total words, for reading-time estimate (computed async)
}

export interface AppState {
  lastView: ViewMode;
  lastBookId: string | null;
  theme: 'dark' | 'light';
  epubFontSizeOffset: number; // default 0, range -4 to +8
  readingSurface: ReadingSurface; // page tint while reading, separate from app theme
  readerMode: ReaderMode; // pages | scroll | flip (UI only for now; default 'pages')
  libraryView: LibraryView; // grid | notes (library layout; default 'grid')
}
