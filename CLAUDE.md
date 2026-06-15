# ReMargin

Кроссплатформенная читалка с аннотациями на полях. Web-first (SPA на Vercel), потом Tauri-обёртка.

## Стек

- Vite + React 19 + TypeScript
- epub.js — рендеринг epub
- pdfjs-dist v6 — рендеринг PDF
- IndexedDB — хранение файлов книг
- localStorage — метаданные, настройки
- CSS Modules, тёмная тема, без Tailwind
- Деплой: Vercel (SPA)

## Архитектура

Весь доступ к данным — через src/services/storage.ts. Компоненты и хуки НЕ обращаются к localStorage/IndexedDB напрямую. Это критично: storage.ts — единственная точка замены при переходе на Google Drive sync.

```
src/
  components/
    library/      — BookGrid, BookCard, ImportDropzone
    reader/       — EpubReader, PdfReader, ReaderToolbar
    annotations/  — AnnotationPanel, HighlightPopover, NoteEditor
  hooks/          — useLibrary, useReader, useAnnotations
  services/       — storage.ts (единый слой данных), epubParser, pdfParser, exportMarkdown
  stores/         — LibraryContext, ReaderContext
  types/          — Book, Annotation, EpubAnchor, PdfAnchor, ViewMode
  styles/         — globals.css, CSS custom properties
```

## Data Model

Book: id, title, author, coverUrl, format (epub|pdf), fileData (IndexedDB), progress (0-100), lastPosition (CFI для epub / page number для pdf), lastOpened, addedAt

Annotation: id, bookId, type (highlight|note), anchor (EpubAnchor|PdfAnchor), highlightedText, note, color, createdAt, updatedAt

## MVP — чеклист

- [x] Импорт epub и pdf (drag-and-drop + file picker)
- [x] Рендеринг epub с пагинацией
- [x] Рендеринг PDF постранично
- [x] Библиотека — сетка обложек
- [x] Progress tracking
- [ ] Выделение текста в epub → highlight
- [ ] Popover на highlight → добавить заметку
- [ ] Панель аннотаций справа (список всех аннотаций книги)
- [ ] Экспорт аннотаций в .md (frontmatter + цитаты по главам)
- [ ] Красивый дизайн библиотеки (тени на обложках, hover-эффекты, GOG-вайб)

## НЕ в MVP

Google Drive sync, рукописный ввод, fb2, аккаунты, мобильный UI, Tauri

## Conventions

- Functional components, hooks для логики
- Named exports для компонентов
- Никаких `any` — все типы в src/types/
- PascalCase файлы для компонентов, camelCase для utils/hooks
- Один сервис storage.ts для всех данных
