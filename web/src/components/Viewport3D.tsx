import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogItem, Room } from '../types';
import { SceneManager, type ViewMode } from '../three/scene';
import { TouchStick } from './TouchStick';

interface Props {
  room: Room;
  catalog: Map<string, CatalogItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, xCm: number, yCm: number, commit: boolean) => void;
}

const HOURS = [
  [7, 'Early'], [10, 'Morning'], [13, 'Midday'], [16, 'Afternoon'], [19, 'Golden'], [22, 'Night'],
] as const;

/**
 * The 3D view.
 *
 * The SceneManager owns the render loop; this component only bridges it to
 * React state. The room is rebuilt when its shell changes, but individual
 * furniture moves are pushed through without a rebuild so dragging stays smooth.
 */
export function Viewport3D({ room, catalog, selectedId, onSelect, onMove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [mode, setMode] = useState<ViewMode>('orbit');
  const [locked, setLocked] = useState(false);
  const [lookingAt, setLookingAt] = useState<string | null>(null);
  const [hour, setHour] = useState(15);
  const [exporting, setExporting] = useState(false);
  const [touch, setTouch] = useState(false);

  // Callbacks change identity every render; a ref keeps the scene's handlers
  // current without tearing down and rebuilding the whole scene.
  const handlers = useRef({ onSelect, onMove });
  handlers.current = { onSelect, onMove };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new SceneManager(canvas, {
      onSelect: (id) => handlers.current.onSelect(id),
      onMove: (id, x, y, commit) => handlers.current.onMove(id, x, y, commit),
      onLookAt: setLookingAt,
      onPointerLock: setLocked,
    });
    sceneRef.current = scene;
    setTouch(scene.isTouchDevice());

    const observer = new ResizeObserver(([entry]) => {
      scene.resize(entry.contentRect.width, entry.contentRect.height);
    });
    if (wrapRef.current) observer.observe(wrapRef.current);

    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Rebuild when the shell or the set of pieces changes. Keyed on the things
  // that actually alter geometry, so a drag does not trigger a full rebuild.
  const shellKey = JSON.stringify({
    poly: room.polygon,
    h: room.heightCm,
    wall: room.wallColor,
    floor: room.floorColor,
    openings: room.openings,
    pieces: (room.furniture ?? []).map((f) => [f.id, f.catalogKey, f.widthCm, f.depthCm, f.heightCm, f.color, f.z, f.rotationDeg]),
  });

  useEffect(() => {
    sceneRef.current?.setRoom(room, catalog);
    sceneRef.current?.setSelection(selectedId);
    // room and catalog are read through the key below rather than tracked
    // directly, so identical content does not cause a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellKey, catalog]);

  useEffect(() => {
    sceneRef.current?.setSelection(selectedId);
  }, [selectedId]);

  useEffect(() => {
    sceneRef.current?.setTimeOfDay(hour);
  }, [hour]);

  const lookLabel = useMemo(() => {
    if (!lookingAt) return null;
    const piece = (room.furniture ?? []).find((f) => f.id === lookingAt);
    if (!piece) return null;
    return `${piece.label} — ${Math.round(piece.widthCm)}×${Math.round(piece.depthCm)}×${Math.round(piece.heightCm)} cm`;
  }, [lookingAt, room.furniture]);

  const switchMode = (next: ViewMode) => {
    setMode(next);
    sceneRef.current?.setMode(next);
  };

  const exportGLB = async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    setExporting(true);
    try {
      const blob = await scene.exportGLB();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${room.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'room'}.glb`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div ref={wrapRef} className="viewport">
      <canvas ref={canvasRef} />

      {/* Controls hide while you are walking, so the view is unobstructed. */}
      {!locked && (
        <div className="viewport-overlay">
          <button className={`btn sm${mode === 'orbit' ? ' primary' : ''}`} onClick={() => switchMode('orbit')}>Orbit</button>
          <button className={`btn sm${mode === 'walk' ? ' primary' : ''}`} onClick={() => switchMode('walk')}>Walk through</button>
          {mode === 'orbit' && <button className="btn sm" onClick={() => sceneRef.current?.frameRoom(room)}>Reframe</button>}
          <button className="btn sm" onClick={exportGLB} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export .glb'}
          </button>
        </div>
      )}

      {!locked && (
        <div className="time-control">
          <label htmlFor="tod">
            Light <strong>{formatHour(hour)}</strong>
          </label>
          <input
            id="tod" type="range" min={6} max={23} step={0.5} value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          />
          <div className="time-presets">
            {HOURS.map(([h, label]) => (
              <button key={label} className="tag" aria-pressed={Math.abs(hour - h) < 0.6} onClick={() => setHour(h)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The crosshair only appears once you actually have control. */}
      {mode === 'walk' && locked && (
        <>
          <div className="crosshair" aria-hidden />
          {lookLabel && <div className="look-label">{lookLabel}</div>}
          <div className="walk-keys">
            {touch ? (
              <>
                <span>Stick to move</span>
                <span>Drag to look</span>
                <span>Orbit to exit</span>
              </>
            ) : (
              <>
                <span><kbd>WASD</kbd> move</span>
                <span><kbd>Shift</kbd> run</span>
                <span><kbd>C</kbd> crouch</span>
                <span><kbd>Esc</kbd> release</span>
              </>
            )}
          </div>
        </>
      )}

      {mode === 'walk' && !locked && !touch && (
        <button className="walk-prompt" onClick={() => sceneRef.current?.requestPointerLock()}>
          <strong>Click to walk around</strong>
          <span>Mouse to look · W A S D to move · Shift to run · Esc to let go</span>
        </button>
      )}

      {mode === 'walk' && touch && (
        <TouchStick onChange={(x, y) => sceneRef.current?.setStick(x, y)} />
      )}

      {mode === 'orbit' && (
        <div className="viewport-hint">
          {touch
            ? 'One finger to turn the room, pinch to zoom, two fingers to pan. Tap a piece to select it, then drag it along the floor.'
            : 'Drag to orbit, scroll to zoom. Click a piece to select it, then drag to slide it along the floor.'}
        </div>
      )}
    </div>
  );
}

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = hour % 1 >= 0.5 ? '30' : '00';
  const suffix = h >= 12 ? 'pm' : 'am';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${m} ${suffix}`;
}
