// Find where the actual content begins inside a rendered PDF page bitmap, so we can
// crop the surrounding margins. Scans only every `step` pixels for speed (a page that
// would otherwise take ~3M pixel reads now takes ~330k). Returns either pixel-space
// bounds (detectContentBoundsPx) or normalised 0..1 bounds — the latter is what the
// reader caches, so the same crop rectangle applies at any render scale.

export interface ContentBoundsPx {
  top: number; // px from canvas top
  bottom: number; // px from canvas top (last content row)
  left: number; // px from canvas left
  right: number; // px from canvas left (last content column)
}

export interface ContentBoundsNorm {
  top: number; // 0..1
  bottom: number;
  left: number;
  right: number;
}

const STEP = 3;

// A pixel counts as content when any RGB channel falls below `threshold`. Default 220
// (not 250) because pdf.js anti-aliasing renders "white" page background at 248-254 —
// a threshold above that would tag the entire margin as content and never trim anything.
// 220 is loose enough to ignore those fringes while still catching faint gray text.
export function detectContentBoundsPx(
  canvas: HTMLCanvasElement,
  threshold = 220,
  padding = 10,
): ContentBoundsPx {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (!ctx || width === 0 || height === 0) {
    return { top: 0, bottom: height, left: 0, right: width };
  }
  const { data } = ctx.getImageData(0, 0, width, height);

  const isContent = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold;
  };

  let top = 0;
  let bottom = height - 1;
  let left = width - 1;
  let right = 0;

  scanTop: for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      if (isContent(x, y)) {
        top = y;
        break scanTop;
      }
    }
  }
  scanBottom: for (let y = height - 1; y >= 0; y -= STEP) {
    for (let x = 0; x < width; x += STEP) {
      if (isContent(x, y)) {
        bottom = y;
        break scanBottom;
      }
    }
  }
  scanLeft: for (let x = 0; x < width; x += STEP) {
    for (let y = top; y <= bottom; y += STEP) {
      if (isContent(x, y)) {
        left = x;
        break scanLeft;
      }
    }
  }
  scanRight: for (let x = width - 1; x >= 0; x -= STEP) {
    for (let y = top; y <= bottom; y += STEP) {
      if (isContent(x, y)) {
        right = x;
        break scanRight;
      }
    }
  }

  // Empty / all-white page — return full canvas so the trim is a no-op.
  if (left >= right || top >= bottom) {
    return { top: 0, bottom: height, left: 0, right: width };
  }

  return {
    top: Math.max(0, top - padding),
    bottom: Math.min(height, bottom + padding),
    left: Math.max(0, left - padding),
    right: Math.min(width, right + padding),
  };
}

export function detectContentBoundsNorm(
  canvas: HTMLCanvasElement,
  threshold = 220,
  padding = 10,
): ContentBoundsNorm {
  const b = detectContentBoundsPx(canvas, threshold, padding);
  return {
    top: b.top / canvas.height,
    bottom: b.bottom / canvas.height,
    left: b.left / canvas.width,
    right: b.right / canvas.width,
  };
}
