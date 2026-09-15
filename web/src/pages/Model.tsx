import { useMemo, useState } from 'react';
import { useStore, useActiveRoom } from '../store';
import { Viewport3D } from '../components/Viewport3D';
import { Empty } from '../components/common';
import type { CatalogItem } from '../types';

const CATEGORY_LABELS: Record<string, string> = {
  seating: 'Seating', tables: 'Tables', storage: 'Storage', lighting: 'Lighting',
  soft: 'Rugs & soft', decor: 'Decor', sleeping: 'Beds', work: 'Work',
};

export function ModelPage() {
  const room = useActiveRoom();
  const reference = useStore((s) => s.reference);
  const { addFurniture, patchFurniture, nudgeFurniture, removeFurniture } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('seating');
  const [search, setSearch] = useState('');

  const catalog = useMemo(
    () => new Map<string, CatalogItem>((reference?.catalog ?? []).map((c) => [c.key, c])),
    [reference],
  );

  const options = useMemo(() => {
    const all = reference?.catalog ?? [];
    const needle = search.trim().toLowerCase();
    if (needle) {
      return all.filter((c) =>
        `${c.name} ${c.role} ${c.tags.join(' ')} ${c.inspiredBy}`.toLowerCase().includes(needle));
    }
    return all.filter((c) => c.category === category);
  }, [reference, category, search]);

  if (!room) {
    return (
      <div className="main-inner">
        <Empty title="No room selected">Add a room from the sidebar to build its model.</Empty>
      </div>
    );
  }

  const place = (item: CatalogItem) => {
    // Drop new pieces at the centre of the room; you drag them from there.
    const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length;
    const cy = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length;
    const wallMounted = item.placement.includes('wall-mounted');
    const ceiling = item.placement.includes('ceiling') || item.placement.includes('over-table');
    addFurniture(room.id, {
      catalogKey: item.key,
      label: item.name,
      x: Math.round(cx), y: Math.round(cy),
      z: wallMounted ? Math.max(0, 145 - item.dims.h / 2) : ceiling ? Math.max(180, room.heightCm - 90) : 0,
      rotationDeg: 0,
      widthCm: item.dims.w, depthCm: item.dims.d, heightCm: item.dims.h,
      color: item.colors.primary,
      source: 'manual',
    });
  };

  const selected = (room.furniture ?? []).find((f) => f.id === selectedId) ?? null;

  return (
    <div className="split">
      <div className="pane-main">
        <Viewport3D
          room={room}
          catalog={catalog}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={(id, x, y, commit) => (commit
            ? patchFurniture(id, { x: Math.round(x), y: Math.round(y) })
            : nudgeFurniture(id, { x, y }))}
        />
      </div>

      <div className="pane-side">
        {selected && (
          <div className="card" style={{ marginBottom: 14, padding: 12 }}>
            <div className="spread" style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>{selected.label}</strong>
              <button className="btn ghost sm danger" onClick={() => { removeFurniture(selected.id); setSelectedId(null); }}>Remove</button>
            </div>
            {selected.catalogKey && catalog.get(selected.catalogKey) && (
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                {catalog.get(selected.catalogKey)!.note}
              </p>
            )}
            <div className="field">
              <label htmlFor="m-rot">Rotation — {Math.round(selected.rotationDeg)}°</label>
              <input
                id="m-rot" type="range" min={0} max={359} value={Math.round(selected.rotationDeg)}
                onChange={(e) => patchFurniture(selected.id, { rotationDeg: Number(e.target.value) })}
              />
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Fine positioning is easier on the Plan tab, where you can see the measurements.
            </p>
          </div>
        )}

        <h4 style={{ marginBottom: 8 }}>Add a piece</h4>
        <input
          type="text" placeholder="Search the catalog…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }}
        />
        {!search && (
          <div className="row wrap" style={{ gap: 4, marginBottom: 10 }}>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <button
                key={key} className="tag" aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >{label}</button>
            ))}
          </div>
        )}

        <div className="stack" style={{ gap: 7 }}>
          {options.map((item) => (
            <button key={item.key} className="room-item" onClick={() => place(item)} title={item.note}>
              <div className="spread" style={{ gap: 6 }}>
                <strong>{item.name}</strong>
                <i style={{ width: 13, height: 13, borderRadius: 3, background: item.colors.primary, flex: '0 0 13px' }} />
              </div>
              <span className="meta" style={{ display: 'block' }}>
                {item.dims.w}×{item.dims.d}×{item.dims.h} cm · {'$'.repeat(item.priceBand)} · {item.era}
              </span>
              <span className="meta" style={{ display: 'block', color: 'var(--ink-3)' }}>after {item.inspiredBy}</span>
            </button>
          ))}
          {!options.length && <p className="small muted">Nothing matches that.</p>}
        </div>
      </div>
    </div>
  );
}
