import type { Annotation, Book } from '../types';

export function exportAnnotationsToMarkdown(
  book: Book,
  annotations: Annotation[],
): string {
  const date = new Date().toISOString().slice(0, 10);
  const sorted = [...annotations].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const grouped = new Map<string, Annotation[]>();
  for (const a of sorted) {
    const chapter =
      (a.anchor.kind === 'epub' ? a.anchor.chapter : `Page ${a.anchor.page}`) || 'Ungrouped';
    const list = grouped.get(chapter) || [];
    list.push(a);
    grouped.set(chapter, list);
  }

  const lines: string[] = [
    '---',
    `title: "${book.title}"`,
    `author: "${book.author}"`,
    `exported: ${date}`,
    `source: remargin`,
    '---',
    '',
    `# ${book.title}`,
    `**${book.author}**`,
    '',
  ];

  for (const [chapter, items] of grouped) {
    lines.push(`## ${chapter}`, '');
    for (const a of items) {
      lines.push(`> ${a.highlightedText}`, '');
      if (a.note) {
        lines.push(a.note, '');
      }
      lines.push('---', '');
    }
  }

  return lines.join('\n');
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
