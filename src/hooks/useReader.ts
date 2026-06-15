import { useContext } from 'react';
import { ReaderContext } from '../stores/ReaderContext';

export function useReader() {
  return useContext(ReaderContext);
}
