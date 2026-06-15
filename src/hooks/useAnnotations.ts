import { useCallback, useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { Annotation, AnchorData, AnnotationColor } from '../types';
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
    (
      text: string,
      anchor: AnchorData,
      chapter: string,
      color: AnnotationColor = 'yellow',
    ) => {
      if (!bookId) return;
      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: uuid(),
        bookId,
        text,
        note: '',
        color,
        chapter,
        anchor,
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
          const updated = { ...a, ...updates, updatedAt: new Date().toISOString() };
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
