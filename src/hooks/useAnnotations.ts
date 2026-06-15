import { useCallback, useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { Annotation, AnchorData, HighlightColor } from '../types';
import {
  loadAnnotations,
  saveAnnotation,
  deleteAnnotation as removeAnnotation,
} from '../services/storage';

export function useAnnotations(bookId: string | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    loadAnnotations(bookId).then((list) => {
      if (!cancelled) setAnnotations(list);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const addAnnotation = useCallback(
    (highlightedText: string, anchor: AnchorData, color: HighlightColor = 'yellow') => {
      if (!bookId) return;
      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: uuid(),
        bookId,
        type: 'highlight',
        anchor,
        highlightedText,
        note: '',
        color,
        createdAt: now,
        updatedAt: now,
      };
      saveAnnotation(annotation);
      setAnnotations((prev) => [...prev, annotation]);
      return annotation;
    },
    [bookId],
  );

  const updateAnnotation = useCallback(
    (id: string, updates: Partial<Pick<Annotation, 'note' | 'color'>>) => {
      setAnnotations((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const updated: Annotation = {
            ...a,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
          // A highlight becomes a note once it carries note text.
          if (updates.note !== undefined) {
            updated.type = updates.note.trim() ? 'note' : 'highlight';
          }
          saveAnnotation(updated);
          return updated;
        }),
      );
    },
    [],
  );

  const deleteAnnotation = useCallback((id: string) => {
    removeAnnotation(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { annotations, addAnnotation, updateAnnotation, deleteAnnotation };
}
