import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

interface Options {
  min?: number;
  max?: number;
  /** Pixels-of-finger-movement → zoom-units multiplier. 0.005 ≈ "natural" feel. */
  sensitivity?: number;
}

// Two-finger pinch-to-zoom on the supplied container. Uses a delta-from-previous-frame
// model (not a ratio from the initial distance) so:
//   - the gesture works the same in both directions (spread and pinch);
//   - tiny errors don't accumulate over a long pinch — each frame is referenced to the
//     last frame, not the start;
//   - there's no jump when the second finger lands or lifts.
// preventDefault only fires while 2 touches are present, so single-finger scrolling is
// undisturbed.
export function usePinchZoom(
  containerRef: RefObject<HTMLElement | null>,
  setZoom: Dispatch<SetStateAction<number>>,
  { min = 0.5, max = 3, sensitivity = 0.005 }: Options = {},
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastDist = 0;
    let pinching = false;

    const distOf = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      lastDist = distOf(e);
    };

    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      const dist = distOf(e);
      const delta = (dist - lastDist) * sensitivity;
      lastDist = dist;
      setZoom((prev) => Math.max(min, Math.min(max, prev + delta)));
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
  }, [containerRef, setZoom, min, max, sensitivity]);
}
