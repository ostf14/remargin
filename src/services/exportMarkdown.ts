import JSZip from 'jszip';
import type { Annotation, Book } from '../types';

/**
 * Slug for filenames: lowercase, spaces → dashes, strip everything except
 * a-z, 0-9, Cyrillic а-яё and dash, collapse/trim dashes, cap at 50 chars.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9а-яё-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** Render a string as a YAML double-quoted scalar (escapes \\, ", newlines, tabs). */
function yamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Date portion (YYYY-MM-DD) of a stored ISO timestamp. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Collapse a quote to a single whitespace-normalised line. */
function flatQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Filename for one annotation: the first ~50 chars of its quote, slugified. */
function annotationFilename(annotation: Annotation): string {
  return `${slugify(flatQuote(annotation.highlightedText).slice(0, 50)) || 'note'}.md`;
}

/** Render one annotation as a Markdown document: YAML frontmatter + quote (+ note). */
function annotationToMarkdown(book: Book, annotation: Annotation): string {
  const a = annotation.anchor;
  // PDF anchors always carry a page; EPUB anchors carry one only on newer
  // annotations (captured at highlight-creation time). Older EPUB annotations
  // without a page field omit the locator line entirely.
  let locLine: string | null = null;
  if (a.kind === 'pdf') locLine = `page: ${a.page}`;
  else if (typeof a.page === 'number') locLine = `page: ${a.page}`;
  const quote = flatQuote(annotation.highlightedText);

  const frontmatter = [
    '---',
    `title: ${yamlString(quote.slice(0, 80))}`,
    `author: ${yamlString(book.author)}`,
    locLine,
    `color: ${annotation.color}`,
    `date: ${dateOnly(annotation.createdAt)}`,
    `book_title: ${yamlString(book.title)}`,
    '---',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const body = annotation.note.trim()
    ? `> ${quote}\n\n${annotation.note.trim()}\n`
    : `> ${quote}\n`;
  return `${frontmatter}\n\n${body}`;
}

/** Trigger a browser download for a Blob via a programmatic <a download> click. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Add annotations to a zip as individual `.md` files, deduping clashing filenames. */
function addAnnotationsToZip(
  zip: JSZip,
  items: { book: Book; annotation: Annotation }[],
): void {
  const used = new Map<string, number>();
  for (const { book, annotation } of items) {
    let name = annotationFilename(annotation);
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) name = name.replace(/\.md$/, `-${seen}.md`);
    zip.file(name, annotationToMarkdown(book, annotation));
  }
}

/** Export a single annotation as one downloaded `.md` file. */
export function exportSingleAnnotation(book: Book, annotation: Annotation): void {
  const content = annotationToMarkdown(book, annotation);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, annotationFilename(annotation));
}

/** Export all of a book's annotations as a `.zip` — one `.md` per highlight. */
export async function exportAllAnnotations(book: Book, annotations: Annotation[]): Promise<void> {
  if (annotations.length === 0) {
    alert('No annotations to export');
    return;
  }
  const zip = new JSZip();
  addAnnotationsToZip(
    zip,
    annotations.map((annotation) => ({ book, annotation })),
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${slugify(book.title) || 'book'}_annotations.zip`);
}

/** Export every book's annotations as one `.zip` — one `.md` per highlight, across all books. */
export async function exportAllBooks(
  groups: { book: Book; annotations: Annotation[] }[],
): Promise<void> {
  const items = groups.flatMap((g) =>
    g.annotations.map((annotation) => ({ book: g.book, annotation })),
  );
  if (items.length === 0) {
    alert('No annotations to export');
    return;
  }
  const zip = new JSZip();
  addAnnotationsToZip(zip, items);
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, 'remargin_annotations.zip');
}
