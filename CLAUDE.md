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

## Engineering Principles

### Before writing code
- What will the user SEE and FEEL? Walk through the interaction mentally, frame by frame.
- What does this change break? Every change has side effects — identify them before coding.
- Am I fixing the root cause or a symptom? If the fix feels like a workaround — stop, find the real problem.

### While writing code
- Optimistic UI, lazy compute: visual feedback must be instant, heavy work debounced/deferred.
- Every async operation needs: loading state, error handling, cancellation of stale operations, and cleanup on unmount.
- State changes must be atomic: if two things must update together, they update in one render. No intermediate broken states visible to the user.

### Before committing
- "First use" test: imagine opening this feature for the first time with no context. Does it make sense? Does anything flash, jump, or feel broken?
- Rapid input test: what happens if the user does this action 5 times in 1 second?
- Empty/error test: what happens with no data, corrupted data, or a network failure?
- Remove all console.log and debug code.
