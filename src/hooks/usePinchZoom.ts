import { useEffect, type RefObject } from 'react';

interface Options {
  min?: number;
  max?: number;
}

// Two-finger pinch-to-zoom on the supplied container. Snapshots the current zoom on
// touchstart with 2 touches, then on touchmove multiplies it by the ratio of the new
// pinch distance over the initial distance. preventDefault on the 2-touch path blocks
// the browser's own pinch — but only when there are 2 touches, so single-finger
// scrolling stays native and responsive.
export function usePinchZoom(
  containerRef: RefObject<HTMLElement | null>,
  getZoom: () => number,
  setZoom: (z: number) => void,
  { min = 0.5, max = 3 }: Options = {},
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let initialDistance = 0;
    let initialZoom = 1;
    let pinching = false;

    const distOf = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      initialDistance = distOf(e);
      initialZoom = getZoom();
    };

    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      const d = distOf(e);
      if (initialDistance <= 0) return;
      const next = Math.max(min, Math.min(max, initialZoom * (d / initialDistance)));
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
  }, [containerRef, getZoom, setZoom, min, max]);
}
