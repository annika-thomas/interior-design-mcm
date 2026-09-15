import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { Spinner } from './components/common';
import { SurveyPage } from './pages/Survey';
import { PlanPage } from './pages/Plan';
import { ModelPage } from './pages/Model';
import { LibraryPage } from './pages/Library';
import { DesignPage } from './pages/Design';

type Tab = 'survey' | 'plan' | 'model' | 'library' | 'design';

const TABS: Array<{ key: Tab; label: string; hint: string; flush?: boolean }> = [
  { key: 'survey', label: 'Survey', hint: 'Photograph the real room' },
  { key: 'plan', label: 'Plan', hint: 'Correct the dimensions and lay it out', flush: true },
  { key: 'model', label: '3D', hint: 'Walk through it', flush: true },
  { key: 'library', label: 'Library', hint: 'Everything you have saved' },
  { key: 'design', label: 'Design', hint: 'What to change, and why' },
];

const ROOM_KINDS = [
  ['living', 'Living Room'], ['bedroom', 'Bedroom'], ['dining', 'Dining Room'],
  ['office', 'Office'], ['kitchen', 'Kitchen'], ['entry', 'Entry'],
  ['studio', 'Studio / Open Plan'], ['other', 'Other'],
] as const;

export default function App() {
  const ready = useStore((s) => s.ready);
  const project = useStore((s) => s.project);
  const projects = useStore((s) => s.projects);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const photos = useStore((s) => s.photos);
  const claudeEnabled = useStore((s) => s.claudeEnabled);
  const boot = useStore((s) => s.boot);
  const { selectProject, createProject, setActiveRoom, addRoom, removeRoom } = useStore();

  const [tab, setTab] = useState<Tab>('survey');

  useEffect(() => { boot(); }, [boot]);

  const active = TABS.find((t) => t.key === tab)!;

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="row"><Spinner /> Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Apartment Planner</strong>
          <span>mid-century modern</span>
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key} className="tab" role="tab"
              aria-selected={tab === t.key}
              title={t.hint}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </nav>

        <div className="topbar-right">
          {!claudeEnabled && (
            <span
              className="pill ochre"
              title="Photo survey and library reading need an Anthropic API key. Everything else works without one."
            >no api key</span>
          )}
          {project && <ExportMenu projectId={project.id} />}
          <select
            value={project?.id ?? ''}
            onChange={(e) => (e.target.value === '__new' ? promptNewProject(createProject) : selectProject(e.target.value))}
            style={{ width: 'auto', maxWidth: 200 }}
            aria-label="Project"
          >
            {!project && <option value="">No project</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__new">+ New apartment…</option>
          </select>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="spread" style={{ marginBottom: 10 }}>
            <h4 style={{ margin: 0 }}>Rooms</h4>
            <button
              className="btn ghost sm"
              disabled={!project}
              onClick={() => addRoom({ name: nextRoomName(project?.rooms.length ?? 0), kind: 'living', widthCm: 420, depthCm: 360 })}
            >+ Add</button>
          </div>

          {!project && <p className="small muted">Create an apartment to begin.</p>}
          {project?.rooms.length === 0 && (
            <p className="small muted">No rooms yet. Add one, then photograph it on the Survey tab.</p>
          )}

          {project?.rooms.map((room) => {
            const count = photos.filter((p) => p.roomId === room.id).length;
            const area = polygonArea(room.polygon);
            return (
              <div key={room.id} style={{ position: 'relative' }}>
                <button
                  className="room-item"
                  aria-selected={activeRoomId === room.id}
                  onClick={() => setActiveRoom(room.id)}
                >
                  <strong>{room.name}</strong>
                  <span className="meta">
                    {area.toFixed(1)} m² · {count} photo{count === 1 ? '' : 's'}
                    {room.analysis ? ` · ${room.analysis.styleScore}/100` : ''}
                  </span>
                </button>
              </div>
            );
          })}

          {project && project.rooms.length > 0 && activeRoomId && (
            <>
              <hr className="divider" />
              <div className="stack" style={{ gap: 8 }}>
                <div className="field">
                  <label htmlFor="quick-kind">Room type</label>
                  <select
                    id="quick-kind"
                    value={project.rooms.find((r) => r.id === activeRoomId)?.kind ?? 'living'}
                    onChange={(e) => useStore.getState().patchRoom(activeRoomId, { kind: e.target.value })}
                  >
                    {ROOM_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                <button
                  className="btn ghost sm danger"
                  onClick={() => {
                    const room = project.rooms.find((r) => r.id === activeRoomId);
                    if (room && confirm(`Delete "${room.name}"? Its photos are kept and move back to unassigned.`)) removeRoom(room.id);
                  }}
                >Delete this room</button>
              </div>
            </>
          )}
        </aside>

        <main className={`main${active.flush ? ' flush' : ''}`}>
          <div className="main-inner">
            {tab === 'survey' && <SurveyPage />}
            {tab === 'plan' && <PlanPage />}
            {tab === 'model' && <ModelPage />}
            {tab === 'library' && <LibraryPage />}
            {tab === 'design' && <DesignPage />}
          </div>
        </main>
      </div>

      <Toasts />
    </div>
  );
}

function ExportMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const links = useMemo(() => ([
    { kind: 'blender' as const, label: 'Blender script (.py)', hint: 'Rebuilds the apartment as named, editable objects' },
    { kind: 'plan' as const, label: 'Plan & shopping list (.md)', hint: 'Every suggestion, grouped by priority' },
    { kind: 'json' as const, label: 'Everything (.json)', hint: 'The full model, for backup or scripting' },
  ]), []);

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(!open)}>Export ▾</button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div
            className="card"
            style={{ position: 'absolute', right: 0, top: 34, width: 292, zIndex: 21, boxShadow: 'var(--shadow)', padding: 8 }}
          >
            {links.map((l) => (
              <a
                key={l.kind}
                className="room-item"
                href={api.exportUrl(projectId, l.kind)}
                onClick={() => setOpen(false)}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <strong>{l.label}</strong>
                <span className="meta">{l.hint}</span>
              </a>
            ))}
            <p className="small muted" style={{ margin: '6px 8px 2px' }}>
              For a mesh instead, use “Export .glb” inside the 3D tab — that one drags straight into Blender.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 500 }}>{t.message}</div>
            {t.detail && <div className="small muted" style={{ marginTop: 2 }}>{t.detail}</div>}
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}

function promptNewProject(create: (name: string) => Promise<void>) {
  const name = prompt('Name this apartment', 'My Apartment');
  if (name?.trim()) create(name.trim());
}

function nextRoomName(count: number): string {
  return ['Living Room', 'Bedroom', 'Kitchen', 'Dining Room', 'Office', 'Entry'][count] ?? `Room ${count + 1}`;
}

function polygonArea(poly: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2 / 10_000;
}
