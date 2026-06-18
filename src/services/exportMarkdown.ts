import JSZip from 'jszip';
import type { Annotation, AnchorData, Book } from '../types';

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

/** Frontmatter `page:` value — page number (pdf) or chapter name (epub). */
function pageField(anchor: AnchorData): number | string {
  return anchor.kind === 'pdf' ? anchor.page : anchor.chapter;
}

/** Filename `{page}` segment — always a filesystem-safe string. */
function pageSlug(anchor: AnchorData): string {
  return anchor.kind === 'pdf' ? String(anchor.page) : slugify(anchor.chapter) || 'ch';
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

/** Build the `.md` filename for one annotation: {title-slug}_{page}_{id8}.md */
function annotationFilename(book: Book, annotation: Annotation): string {
  const title = slugify(book.title) || 'book';
  const page = pageSlug(annotation.anchor);
  const idShort = annotation.id.slice(0, 8);
  return `${title}_${page}_${idShort}.md`;
}

/** Render one annotation as a Markdown document: YAML frontmatter + note body. */
function annotationToMarkdown(book: Book, annotation: Annotation): string {
  const page = pageField(annotation.anchor);
  const pageLine = typeof page === 'number' ? `page: ${page}` : `page: ${yamlString(page)}`;

  const frontmatter = [
    '---',
    `book: ${yamlString(book.title)}`,
    `author: ${yamlString(book.author)}`,
    pageLine,
    `quote: ${yamlString(annotation.highlightedText)}`,
    `color: ${annotation.color}`,
    `date_created: ${dateOnly(annotation.createdAt)}`,
    `date_modified: ${dateOnly(annotation.updatedAt)}`,
    'tags: []',
    '---',
  ].join('\n');

  // highlight-only (no note) → empty body
  return annotation.note ? `${frontmatter}\n\n${annotation.note}\n` : `${frontmatter}\n`;
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

/** Export a single annotation as one downloaded `.md` file. */
export function exportSingleAnnotation(book: Book, annotation: Annotation): void {
  const content = annotationToMarkdown(book, annotation);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, annotationFilename(book, annotation));
}

/** Export all annotations of a book as a `.zip` of individual `.md` files. */
export async function exportAllAnnotations(
  book: Book,
  annotations: Annotation[],
): Promise<void> {
  if (annotations.length === 0) {
    alert('No annotations to export');
    return;
  }

  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const annotation of annotations) {
    let name = annotationFilename(book, annotation);
    // guard against (extremely unlikely) duplicate filenames within one archive
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) {
      name = name.replace(/\.md$/, `-${seen}.md`);
    }
    zip.file(name, annotationToMarkdown(book, annotation));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${slugify(book.title) || 'book'}_annotations.zip`);
}

/** All of a book's annotations as ONE Markdown doc: book frontmatter + each entry. */
export function bookToMarkdown(book: Book, annotations: Annotation[]): string {
  const frontmatter = [
    '---',
    `book: ${yamlString(book.title)}`,
    `author: ${yamlString(book.author)}`,
    `annotations: ${annotations.length}`,
    'tags: []',
    '---',
  ].join('\n');

  const entries = annotations
    .map((a) => {
      const loc = a.anchor.kind === 'pdf' ? `p. ${a.anchor.page}` : a.anchor.chapter;
      const quote = a.highlightedText.replace(/\s*\n\s*/g, ' ').trim();
      const lines = [`> ${quote}`, '', `— ${loc} · ${dateOnly(a.createdAt)}`];
      if (a.note.trim()) lines.push('', a.note.trim());
      return lines.join('\n');
    })
    .join('\n\n---\n\n');

  return `${frontmatter}\n\n# ${book.title}\n\n${entries}\n`;
}

/** Export all of a book's annotations as a single downloaded `.md` file. */
export function exportBookMarkdown(book: Book, annotations: Annotation[]): void {
  if (annotations.length === 0) return;
  const blob = new Blob([bookToMarkdown(book, annotations)], {
    type: 'text/markdown;charset=utf-8',
  });
  triggerDownload(blob, `${slugify(book.title) || 'book'}.md`);
}

/** Export every book's annotations as a `.zip` — one combined `.md` per book. */
export async function exportLibraryAnnotations(
  groups: { book: Book; annotations: Annotation[] }[],
): Promise<void> {
  const withAny = groups.filter((g) => g.annotations.length > 0);
  if (withAny.length === 0) {
    alert('No annotations to export');
    return;
  }
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const { book, annotations } of withAny) {
    let name = `${slugify(book.title) || 'book'}.md`;
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) name = name.replace(/\.md$/, `-${seen}.md`);
    zip.file(name, bookToMarkdown(book, annotations));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, 'remargin_annotations.zip');
}
