import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

interface Options {
  min?: number;
  max?: number;
}

// Two-finger pinch-to-zoom on the supplied container. Ratio-based, locked to the start
// of the gesture:
//   startDist + startZoom are snapshotted on touchstart and DON'T update while pinching;
//   each move computes `dist / startDist`, multiplies by startZoom, clamps, and applies.
// That keeps the gesture smooth (no per-frame stepping from a tiny delta multiplier) and
// reversible (releasing back to the start distance returns to the start zoom). Reading
// the current zoom on touchstart is done via the `zoomRef` param so the hook never goes
// stale when the parent's zoom changes between gestures.
export function usePinchZoom(
  containerRef: RefObject<HTMLElement | null>,
  zoomRef: RefObject<number>,
  setZoom: Dispatch<SetStateAction<number>>,
  { min = 0.5, max = 3 }: Options = {},
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startDist = 0;
    let startZoom = 1;
    let pinching = false;

    const distOf = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      startDist = distOf(e);
      startZoom = zoomRef.current ?? 1;
    };

    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      const dist = distOf(e);
      if (startDist <= 0) return;
      const ratio = dist / startDist;
      const next = Math.max(min, Math.min(max, startZoom * ratio));
      setZoom(next);
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinching = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [containerRef, zoomRef, setZoom, min, max]);
}
