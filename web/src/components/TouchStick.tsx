import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Called with -1..1 on each axis; y is positive walking forward. */
  onChange: (x: number, y: number) => void;
}

const RADIUS = 52;

/**
 * An on-screen movement stick for walking on a touch device.
 *
 * Sits in the lower-left where a thumb rests, and reports an analogue vector so
 * a half-push walks slowly.
 *
 * Tracking is done with window listeners rather than `setPointerCapture`:
 * capture throws if the pointer is already gone, which aborts the handler
 * before it ever reports a value, and window listeners also mean your thumb can
 * wander off the pad mid-push without the character stopping dead.
 */
export function TouchStick({ onChange }: Props) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  // The callback identity changes every render; a ref keeps the window
  // listeners pointing at the current one without re-subscribing.
  const report = useRef(onChange);
  report.current = onChange;

  const update = useCallback((clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const angle = Math.atan2(dy, dx);
    const clamped = Math.min(Math.hypot(dx, dy), RADIUS);
    const kx = Math.cos(angle) * clamped;
    const ky = Math.sin(angle) * clamped;
    setKnob({ x: kx, y: ky });
    // Screen y grows downward; forward is up, so the sign flips.
    report.current(kx / RADIUS, -ky / RADIUS);
  }, []);

  const release = useCallback(() => {
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    report.current(0, 0);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (activeId.current !== event.pointerId) return;
      event.preventDefault();
      update(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      if (activeId.current !== event.pointerId) return;
      release();
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // Never leave the player walking into a wall after the stick unmounts.
      report.current(0, 0);
    };
  }, [update, release]);

  return (
    <div
      ref={baseRef}
      className="touch-stick"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        activeId.current = e.pointerId;
        update(e.clientX, e.clientY);
      }}
      role="application"
      aria-label="Movement stick"
    >
      <span className="touch-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
