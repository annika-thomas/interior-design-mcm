import { useMemo, useState } from 'react';
import { useStore, useActiveRoom } from '../store';
import { FloorPlan } from '../components/FloorPlan';
import { Empty, cm } from '../components/common';
import type { CatalogItem, Point } from '../types';

const ROOM_KINDS = ['living', 'dining', 'bedroom', 'office', 'entry', 'kitchen', 'studio', 'other'] as const;

/** Shoelace area, in square metres. */
function areaSqm(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2 / 10_000;
}

export function PlanPage() {
  const room = useActiveRoom();
  const reference = useStore((s) => s.reference);
  const {
    patchRoom, patchFurniture, removeFurniture, addOpening, patchOpening, removeOpening,
    nudgeFurniture, nudgeOpening, nudgePolygon,
  } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const catalog = useMemo(
    () => new Map<string, CatalogItem>((reference?.catalog ?? []).map((c) => [c.key, c])),
    [reference],
  );

  if (!room) {
    return (
      <div className="main-inner">
        <Empty title="No room selected">Add a room from the sidebar to start laying it out.</Empty>
      </div>
    );
  }

  const selected = (room.furniture ?? []).find((f) => f.id === selectedId) ?? null;
  const bounds = {
    w: Math.max(...room.polygon.map((p) => p.x)) - Math.min(...room.polygon.map((p) => p.x)),
    d: Math.max(...room.polygon.map((p) => p.y)) - Math.min(...room.polygon.map((p) => p.y)),
  };

  /** Resize a rectangular room by dragging its numbers rather than its corners. */
  const resizeRect = (widthCm: number, depthCm: number) => {
    patchRoom(room.id, {
      polygon: [
        { x: 0, y: 0 }, { x: widthCm, y: 0 }, { x: widthCm, y: depthCm }, { x: 0, y: depthCm },
      ],
    });
  };

  // Every drag handler follows the same shape: move it locally while the
  // pointer is down so it tracks the cursor, then write once on release.
  const moveVertex = (index: number, point: Point, commit: boolean) => {
    const polygon = room.polygon.map((p, i) => (i === index ? point : p));
    if (commit) patchRoom(room.id, { polygon });
    else nudgePolygon(room.id, polygon);
  };

  return (
    <div className="split">
      <div className="pane-main" style={{ padding: 16 }}>
        <FloorPlan
          room={room}
          catalog={catalog}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMoveFurniture={(id, x, y, commit) => (commit ? patchFurniture(id, { x, y }) : nudgeFurniture(id, { x, y }))}
          onRotateFurniture={(id, rotationDeg, commit) => (commit ? patchFurniture(id, { rotationDeg }) : nudgeFurniture(id, { rotationDeg }))}
          onMoveVertex={moveVertex}
          onMoveOpening={(id, offsetCm, commit) => (commit ? patchOpening(id, { offsetCm }) : nudgeOpening(id, { offsetCm }))}
        />
      </div>

      <div className="pane-side">
        <div className="stack">
          <div>
            <h4 style={{ marginBottom: 8 }}>Room</h4>
            <div className="stack" style={{ gap: 9 }}>
              <div className="field">
                <label htmlFor="room-name">Name</label>
                <input
                  id="room-name" type="text" value={room.name}
                  onChange={(e) => patchRoom(room.id, { name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="room-kind">Type</label>
                <select id="room-kind" value={room.kind} onChange={(e) => patchRoom(room.id, { kind: e.target.value })}>
                  {ROOM_KINDS.map((k) => (
                    <option key={k} value={k}>{reference?.roomPrograms[k]?.label ?? k}</option>
                  ))}
                </select>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="room-w">Width</label>
                  <input
                    id="room-w" type="number" value={Math.round(bounds.w)} min={80} step={5}
                    onChange={(e) => resizeRect(Number(e.target.value) || 100, Math.round(bounds.d))}
                    disabled={room.polygon.length !== 4}
                  />
                </div>
                <div className="field">
                  <label htmlFor="room-d">Depth</label>
                  <input
                    id="room-d" type="number" value={Math.round(bounds.d)} min={80} step={5}
                    onChange={(e) => resizeRect(Math.round(bounds.w), Number(e.target.value) || 100)}
                    disabled={room.polygon.length !== 4}
                  />
                </div>
                <div className="field">
                  <label htmlFor="room-h">Ceiling</label>
                  <input
                    id="room-h" type="number" value={room.heightCm} min={180} step={5}
                    onChange={(e) => patchRoom(room.id, { heightCm: Number(e.target.value) || 260 })}
                  />
                </div>
              </div>
              {room.polygon.length !== 4 && (
                <p className="small muted" style={{ margin: 0 }}>
                  This room is not a rectangle, so drag its corners on the plan to resize it.
                </p>
              )}
              <div className="row">
                <div className="field">
                  <label htmlFor="wall-color">Walls</label>
                  <input
                    id="wall-color" type="color" value={room.wallColor}
                    onChange={(e) => patchRoom(room.id, { wallColor: e.target.value })}
                    style={{ height: 34, padding: 2 }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="floor-color">Floor</label>
                  <input
                    id="floor-color" type="color" value={room.floorColor}
                    onChange={(e) => patchRoom(room.id, { floorColor: e.target.value })}
                    style={{ height: 34, padding: 2 }}
                  />
                </div>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {areaSqm(room.polygon).toFixed(1)} m² of floor. {room.floorMaterial}.
              </p>
            </div>
          </div>

          <hr className="divider" style={{ margin: '4px 0' }} />

          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Doors & windows</h4>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => addOpening(room.id, { kind: 'window', wallIndex: 0, offsetCm: 60, widthCm: 120, heightCm: 140, sillCm: 90 })}>+ Window</button>
                <button className="btn sm" onClick={() => addOpening(room.id, { kind: 'door', wallIndex: 0, offsetCm: 30, widthCm: 81, heightCm: 203, sillCm: 0 })}>+ Door</button>
              </div>
            </div>
            {!(room.openings ?? []).length && (
              <p className="small muted" style={{ margin: 0 }}>None yet. Add one, then drag it along its wall on the plan.</p>
            )}
            {(room.openings ?? []).map((o) => (
              <div key={o.id} className="card" style={{ padding: 10, marginTop: 8 }}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <span className={`pill ${o.kind === 'door' ? 'ochre' : 'teal'}`}>{o.kind}</span>
                  <button className="btn ghost sm danger" onClick={() => removeOpening(o.id)}>Remove</button>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <div className="field">
                    <label>Wall</label>
                    <select value={o.wallIndex} onChange={(e) => patchOpening(o.id, { wallIndex: Number(e.target.value) })}>
                      {room.polygon.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Width</label>
                    <input type="number" value={o.widthCm} step={5} onChange={(e) => patchOpening(o.id, { widthCm: Number(e.target.value) })} />
                  </div>
                  <div className="field">
                    <label>Height</label>
                    <input type="number" value={o.heightCm} step={5} onChange={(e) => patchOpening(o.id, { heightCm: Number(e.target.value) })} />
                  </div>
                  {o.kind !== 'door' && (
                    <div className="field">
                      <label>Sill</label>
                      <input type="number" value={o.sillCm} step={5} onChange={(e) => patchOpening(o.id, { sillCm: Number(e.target.value) })} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <hr className="divider" style={{ margin: '4px 0' }} />

          <div>
            <h4 style={{ marginBottom: 8 }}>
              {selected ? 'Selected piece' : `${(room.furniture ?? []).length} piece(s) in the room`}
            </h4>
            {selected ? (
              <div className="stack" style={{ gap: 9 }}>
                <div className="field">
                  <label htmlFor="piece-label">Label</label>
                  <input id="piece-label" type="text" value={selected.label} onChange={(e) => patchFurniture(selected.id, { label: e.target.value })} />
                </div>
                <div className="row">
                  {(['widthCm', 'depthCm', 'heightCm'] as const).map((k) => (
                    <div className="field" key={k}>
                      <label>{k.replace('Cm', '')}</label>
                      <input type="number" step={1} value={Math.round(selected[k])} onChange={(e) => patchFurniture(selected.id, { [k]: Number(e.target.value) })} />
                    </div>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="piece-rot">Rotation — {Math.round(selected.rotationDeg)}°</label>
                  <input
                    id="piece-rot" type="range" min={0} max={359} step={1} value={Math.round(selected.rotationDeg)}
                    onChange={(e) => patchFurniture(selected.id, { rotationDeg: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="piece-z">Height off the floor — {cm(selected.z)}</label>
                  <input
                    id="piece-z" type="range" min={0} max={Math.max(0, room.heightCm - selected.heightCm)} step={1} value={selected.z}
                    onChange={(e) => patchFurniture(selected.id, { z: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="piece-color">Colour</label>
                  <input id="piece-color" type="color" value={selected.color ?? '#8A7A5C'} onChange={(e) => patchFurniture(selected.id, { color: e.target.value })} style={{ height: 34, padding: 2 }} />
                </div>
                {selected.notes && <p className="small muted" style={{ margin: 0 }}>{selected.notes}</p>}
                <div className="row">
                  <button className="btn sm" onClick={() => setSelectedId(null)}>Deselect</button>
                  <button className="btn sm danger" onClick={() => { removeFurniture(selected.id); setSelectedId(null); }}>Remove</button>
                </div>
              </div>
            ) : (
              <div>
                {(room.furniture ?? []).map((f) => (
                  <button key={f.id} className="room-item" onClick={() => setSelectedId(f.id)}>
                    <strong>{f.label}</strong>
                    <span className="meta">{Math.round(f.widthCm)}×{Math.round(f.depthCm)}×{Math.round(f.heightCm)} cm{f.source === 'existing' ? ' · already owned' : ''}</span>
                  </button>
                ))}
                {!(room.furniture ?? []).length && (
                  <p className="small muted" style={{ margin: 0 }}>Nothing placed. Add pieces from the 3D tab, or generate a plan on the Design tab.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
