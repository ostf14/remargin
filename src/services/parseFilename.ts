// Best-effort parse of a book filename into { title, author }, used as a fallback
// when a file carries no usable embedded metadata.
//   "Author - Title.ext" → { author: "Author", title: "Title" }
//   "Title.ext"          → { author: "",        title: "Title" }
export function parseFilename(filename: string): { title: string; author: string } {
  const name = filename.replace(/\.[^.]+$/, '').trim(); // drop the extension
  const sep = name.indexOf(' - ');
  if (sep > 0) {
    const author = name.slice(0, sep).trim();
    const title = name.slice(sep + 3).trim();
    if (title) return { title, author };
  }
  return { title: name, author: '' };
}
