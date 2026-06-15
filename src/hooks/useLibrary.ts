import { useContext } from 'react';
import { LibraryContext } from '../stores/LibraryContext';

export function useLibrary() {
  return useContext(LibraryContext);
}
