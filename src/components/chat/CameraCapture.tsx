"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** How long to wait before admitting the camera is not coming. */
const SLOW_START_MS = 9000;

type Facing = "user" | "environment";

interface Props {
  onCapture: (file: File) => void | Promise<void>;
  onClose: () => void;
  /**
   * Called when the browser will not open a camera at all, so the composer can
   * fall back to the OS picker with `capture` set.
   */
  onUnavailable: () => void;
}

/**
 * Take a photo, in the app, on either kind of device.
 *
 * `<input type="file" capture>` would be a one-line version of this on a
 * phone, but on a laptop it degrades to an ordinary file picker with no camera
 * anywhere — and the point was to work on both. `getUserMedia` gives the same
 * flow on each: a live preview, a shutter, and a look at the shot before it is
 * sent. The input-with-capture fallback is still there for the browsers that
 * refuse the stream.
 *
 * The stream is stopped on every exit path. A camera left running is a lit
 * indicator light on the user's device and a genuine privacy problem, not just
 * a leak.
 */
export default function CameraCapture({
  onCapture,
  onClose,
  onUnavailable,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotUrlRef = useRef<string | null>(null);

  /**
   * The in-flight `getUserMedia`, kept so repeated opens share one request.
   *
   * This is what makes the component survive React StrictMode, which
   * double-invokes effects in development. Two overlapping opens of the *same*
   * physical webcam is not a hypothetical: Windows generally refuses the
   * second with NotReadableError, and since the first run's cleanup stops its
   * own stream, the result is a permission prompt followed by a black screen.
   */
  const requestRef = useRef<{
    mode: Facing;
    promise: Promise<MediaStream>;
  } | null>(null);
  /** Pending device release, cancelled if the effect turns out to be re-running. */
  const teardownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [facing, setFacing] = useState<Facing>("environment");
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * The device has been asked for and has not answered yet.
   *
   * Worth its own state because the wait is long and completely invisible
   * otherwise: a real webcam routinely takes two or three seconds to wake, and
   * an unannounced black rectangle with a dead shutter button reads as "the
   * camera is broken" rather than "the camera is starting".
   */
  const [starting, setStarting] = useState(true);
  /** Some devices have only one camera; hide the flip control there. */
  const [canFlip, setCanFlip] = useState(false);

  /**
   * Held in a ref, not closed over.
   *
   * `start` is an effect dependency, and the effect owns a physical device. A
   * parent that passes this as an inline arrow would otherwise change `start`
   * on every render, re-running the effect and thrashing the camera open and
   * shut — which is not a theoretical cost here, it is a black viewfinder.
   */
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    requestRef.current = null;
    setReady(false);
  }, []);

  /** Gives up waiting and offers a way out, without abandoning the request. */
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(
    async (mode: Facing, isStale: () => boolean) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailableRef.current();
        return;
      }

      // Switching cameras means letting go of the current one first; most
      // devices will not hand over the second while the first is held.
      if (requestRef.current && requestRef.current.mode !== mode) release();

      if (!requestRef.current) {
        requestRef.current = {
          mode,
          promise: navigator.mediaDevices.getUserMedia({
            // `ideal`, never exact. A laptop has no rear camera, and an exact
            // facingMode there fails outright rather than falling back to the
            // one camera that does exist.
            video: { facingMode: { ideal: mode }, width: { ideal: 1600 } },
            audio: false,
          }),
        };
      }

      setStarting(true);
      setError(null);

      // Some drivers never answer at all — a camera held by another
      // application can leave the promise pending indefinitely rather than
      // rejecting. The request is left running in case it does come good.
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      slowTimerRef.current = setTimeout(() => {
        if (isStale()) return;
        setError(
          "The camera is taking longer than it should. It may be in use by another app — close that and try again.",
        );
      }, SLOW_START_MS);

      try {
        const stream = await requestRef.current.promise;

        // A stale run must leave the stream alone — the run that replaced it
        // is waiting on this very promise.
        if (isStale()) return;

        if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        setStarting(false);
        setError(null);
      } catch (streamError) {
        requestRef.current = null;
        if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
        if (isStale()) return;
        setStarting(false);

        const name =
          streamError instanceof DOMException ? streamError.name : "";

        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(
            "Camera permission was refused. Allow it for this site in your browser settings, then try again.",
          );
          return;
        }

        if (name === "NotFoundError" || name === "OverconstrainedError") {
          // No camera matching that facing mode. On a laptop that is the rear
          // camera, which simply does not exist — try the other way round
          // before giving up on the stream entirely.
          if (mode === "environment") {
            setFacing("user");
            return;
          }
          onUnavailableRef.current();
          return;
        }

        if (name === "NotReadableError" || name === "AbortError") {
          setError(
            "Your camera is busy. Close anything else using it — Teams, Zoom, another tab — and try again.",
          );
          return;
        }

        setError("Couldn't open the camera.");
      }
    },
    [release],
  );

  useEffect(() => {
    let stale = false;

    // A queued teardown means the previous cleanup was StrictMode's dry run,
    // not a real unmount. Cancel it and keep the device.
    if (teardownRef.current) {
      clearTimeout(teardownRef.current);
      teardownRef.current = null;
    }

    void start(facing, () => stale);

    return () => {
      stale = true;
      // Deferred by a tick: on a genuine unmount nothing cancels this and the
      // device is released; on a StrictMode re-run the effect above cancels it
      // before it fires, so the stream it is about to reuse survives.
      teardownRef.current = setTimeout(release, 0);
    };
  }, [facing, start, release]);

  /** Retries the current facing mode after a failure. */
  const retry = useCallback(() => {
    release();
    setError(null);
    setStarting(true);
    void start(facing, () => false);
  }, [facing, release, start]);

  useEffect(() => {
    (async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices
        .enumerateDevices()
        .catch(() => [] as MediaDeviceInfo[]);
      setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const take = async () => {
    const video = videoRef.current;
    if (!video || !ready) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The preview is mirrored for the front camera because that is what people
    // expect of a mirror; the saved photo must not be, or text in the shot
    // comes out backwards.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) {
      setError("Couldn't capture that frame.");
      return;
    }

    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    const url = URL.createObjectURL(blob);
    shotUrlRef.current = url;
    setShot({ url, blob });
    // Freeing the camera while the shot is being reviewed keeps the indicator
    // light off for as long as the preview is up.
    release();
  };

  const retake = () => {
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    shotUrlRef.current = null;
    setShot(null);
    void start(facing, () => false);
  };

  const send = async () => {
    if (!shot) return;
    const file = new File([shot.blob], `photo-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    release();
    onClose();
    await onCapture(file);
  };

  /**
   * Rendered into `document.body` via a portal rather than in place.
   *
   * The composer bar this is invoked from carries `backdrop-blur`, and per the
   * CSS spec a `backdrop-filter` (like `filter` and `transform`) on an
   * ancestor becomes the containing block for any `position: fixed`
   * descendant. Left in place, this sheet's "cover the whole screen" resolved
   * to "cover the composer bar" — a live camera stream, correctly acquired,
   * rendered into a box the size of the message input. A portal escapes that
   * DOM subtree entirely while React's props, state and callbacks stay wired
   * exactly as before; only where the markup lands in the tree changes.
   */
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-50 flex flex-col bg-black">
      <header className="flex shrink-0 items-center justify-between px-3 py-3 text-white">
        <button
          type="button"
          onClick={() => {
            release();
            onClose();
          }}
          title="Close camera"
          aria-label="Close camera"
          className="grid h-10 w-10 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/10"
        >
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <span className="text-[0.8125rem] text-white/70">
          {shot ? "Send this?" : "Camera"}
        </span>

        {!shot && canFlip ? (
          <button
            type="button"
            onClick={() =>
              setFacing((current) =>
                current === "user" ? "environment" : "user",
              )
            }
            title="Switch camera"
            aria-label="Switch camera"
            className="grid h-10 w-10 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/10"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M3 7.2A6 6 0 0 1 13.6 4.6M15 10.8A6 6 0 0 1 4.4 13.4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M2.6 3.6v3.6h3.6M15.4 14.4v-3.6h-3.6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="h-10 w-10" />
        )}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {shot ? (
          <img
            src={shot.url}
            alt="The photo you just took"
            className="h-full w-full object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
            style={{
              transform: facing === "user" ? "scaleX(-1)" : undefined,
            }}
          />
        )}

        {starting && !error && !shot && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-3">
              <span
                aria-hidden
                className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white"
              />
              <p className="text-[0.8125rem] text-white/70">Starting camera…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-5 top-1/2 -translate-y-1/2 rounded-2xl bg-black/80 px-5 py-4 text-center backdrop-blur-sm">
            <p className="text-[0.875rem] leading-snug text-white">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-full bg-white px-4 py-1.5 text-[0.8125rem] font-medium text-black transition-transform hover:scale-105"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <div
        className="flex shrink-0 items-center justify-center gap-8 px-6 pt-5"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        {shot ? (
          <>
            <button
              type="button"
              onClick={retake}
              className="rounded-full border border-white/30 px-5 py-2.5 text-[0.875rem] text-white transition-colors hover:bg-white/10"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={() => void send()}
              className="rounded-full bg-white px-6 py-2.5 text-[0.875rem] font-medium text-black transition-transform hover:scale-105"
            >
              Send
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void take()}
            disabled={!ready}
            title="Take a photo"
            aria-label="Take a photo"
            className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-[3px] border-white/70 transition-transform active:scale-95 disabled:opacity-40"
          >
            <span className="h-[3.4rem] w-[3.4rem] rounded-full bg-white" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
