import { useEffect, useRef, useState } from 'react';
import type { CatalogItem, Room } from '../types';
import { SceneManager, type ViewMode } from '../three/scene';

interface Props {
  room: Room;
  catalog: Map<string, CatalogItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, xCm: number, yCm: number, commit: boolean) => void;
}

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
  const [exporting, setExporting] = useState(false);

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
    });
    sceneRef.current = scene;

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
      <div className="viewport-overlay">
        <button className={`btn sm${mode === 'orbit' ? ' primary' : ''}`} onClick={() => switchMode('orbit')}>Orbit</button>
        <button className={`btn sm${mode === 'walk' ? ' primary' : ''}`} onClick={() => switchMode('walk')}>Walk through</button>
        <button className="btn sm" onClick={() => sceneRef.current?.frameRoom(room)}>Reframe</button>
        <button className="btn sm" onClick={exportGLB} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export .glb'}
        </button>
      </div>
      <div className="viewport-hint">
        {mode === 'orbit'
          ? 'Drag to orbit, scroll to zoom. Click a piece to select it, then drag to slide it along the floor.'
          : 'Eye level, 1.62 m. W A S D or arrows to move, shift to go faster, drag to look around.'}
      </div>
    </div>
  );
}
