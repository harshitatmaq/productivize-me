/**
 * A short burst of confetti (no library). Skipped when the OS asks for reduced motion.
 */
export function celebrate(origin?: { x: number; y: number }) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "9999" });
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.remove();
  ctx.scale(dpr, dpr);
  const colors = ["#5e6ad2", "#2f9e6e", "#d9730d", "#e5484d", "#f5d90a", "#7c3aed", "#0ea5e9"];
  const ox = origin?.x ?? window.innerWidth / 2;
  const oy = origin?.y ?? window.innerHeight * 0.6;
  const parts = Array.from({ length: 110 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 7 + Math.random() * 9;
    return { x: ox, y: oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)], rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3 };
  });
  const start = performance.now();
  const frame = (t: number) => {
    const p = (t - start) / 1600;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const q of parts) {
      q.vy += 0.32;
      q.vx *= 0.985;
      q.x += q.vx;
      q.y += q.vy;
      q.rot += q.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * p);
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillStyle = q.c;
      ctx.fillRect(-q.r, -q.r / 2, q.r * 2, q.r);
      ctx.restore();
    }
    if (p < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
