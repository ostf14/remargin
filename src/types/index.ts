export type BookFormat = 'epub' | 'pdf';

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink';

export type ViewMode = 'library' | 'reader';

export type NoteStatus = 'fragment' | 'draft' | 'synthesis' | 'published';

export interface EpubAnchor {
  type: 'epub';
  cfiRange: string;
  sectionIndex?: number;
  sectionHref?: string;
}

export interface PdfAnchor {
  type: 'pdf';
  page: number;
}

export type AnchorData = EpubAnchor | PdfAnchor;

export interface Annotation {
  id: string;
  bookId: string;
  text: string;
  note: string;
  color: AnnotationColor;
  chapter: string;
  anchor: AnchorData;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingProgress {
  location: string;
  percentage: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  coverUrl: string;
  addedAt: string;
  lastOpenedAt: string;
  progress: ReadingProgress;
  totalPages?: number;
}
