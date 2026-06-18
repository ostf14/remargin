import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LibraryProvider } from './stores/LibraryContext';
import { ReaderProvider } from './stores/ReaderContext';
import App from './App';
import './styles/globals.css';

// Block the browser's own zoom (Ctrl/Cmd + wheel and Ctrl/Cmd +/-/0) app-wide. The
// readers' built-in zoom uses its own handlers (which also call preventDefault), so it
// keeps working — this only stops the whole page from scaling.
document.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener('keydown', (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')
  ) {
    e.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LibraryProvider>
      <ReaderProvider>
        <App />
      </ReaderProvider>
    </LibraryProvider>
  </StrictMode>,
);
