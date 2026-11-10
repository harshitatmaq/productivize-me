"use client";

import { useEffect } from "react";

export interface LightboxImage {
  url: string;
  width: number;
  height: number;
}

interface Props {
  image: LightboxImage;
  onClose: () => void;
}

export default function ImageLightbox({ image, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // The list behind must not scroll while the overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image"
      onClick={onClose}
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <img
        src={image.url}
        alt=""
        width={image.width}
        height={image.height}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />

      <button
        type="button"
        onClick={onClose}
        title="Close"
        aria-label="Close"
        className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M4.5 4.5l9 9m0-9l-9 9"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
