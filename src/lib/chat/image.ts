"use client";

/** Long-edge cap for uploads. Comfortably beyond any phone screen. */
const MAX_EDGE = 1600;
/** Below this, re-encoding usually makes the file bigger, not smaller. */
const REENCODE_ABOVE_BYTES = 400 * 1024;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  extension: string;
}

/**
 * Normalises a picked image for sending: reads its true dimensions and, when
 * it is a large phone photo, downscales and re-encodes it to WebP.
 *
 * A modern phone camera produces 4–12 MB files that no chat bubble will ever
 * render at full size. Shrinking here keeps sends fast on mobile data, keeps
 * queued images small enough to sit in IndexedDB, and stretches the free
 * Storage tier a very long way.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const longEdge = Math.max(width, height);

  const needsResize = longEdge > MAX_EDGE;
  const needsShrink = file.size > REENCODE_ABOVE_BYTES;

  // GIFs are almost certainly animated; re-encoding would freeze them.
  if (file.type === "image/gif" || (!needsResize && !needsShrink)) {
    bitmap.close();
    return {
      blob: file,
      width,
      height,
      extension: extensionFor(file.type),
    };
  }

  const scale = needsResize ? MAX_EDGE / longEdge : 1;
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { blob: file, width, height, extension: extensionFor(file.type) };
  }

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82)
  );

  // If the browser refused WebP, or the result somehow grew, keep the original.
  if (!encoded || encoded.size >= file.size) {
    return { blob: file, width, height, extension: extensionFor(file.type) };
  }

  return {
    blob: encoded,
    width: targetWidth,
    height: targetHeight,
    extension: "webp",
  };
}

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  return map[mime] ?? "jpg";
}
