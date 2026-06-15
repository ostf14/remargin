import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LibraryProvider } from './stores/LibraryContext';
import { ReaderProvider } from './stores/ReaderContext';
import App from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LibraryProvider>
      <ReaderProvider>
        <App />
      </ReaderProvider>
    </LibraryProvider>
  </StrictMode>,
);
