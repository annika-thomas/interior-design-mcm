import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore, useActiveRoom } from '../store';
import { Empty, FindingList, ScoreDial, Spinner } from '../components/common';
import type { Suggestion } from '../types';

const PRIORITY_LABEL = { 1: 'Do first', 2: 'Then', 3: 'Eventually' } as const;
const EFFORT_LABEL = { free: 'free — just move things', cheap: 'inexpensive', invest: 'an investment' } as const;

/**
 * The plan for the room.
 *
 * Suggestions are ordered by what unblocks the most: free rearrangements
 * before purchases, anchor pieces before accessories. Anything that matches
 * something in your library says so, because a plan built from things you have
 * already chosen is one you will actually follow.
 */
export function DesignPage() {
  const project = useStore((s) => s.project);
  const room = useActiveRoom();
  const suggestions = useStore((s) => s.suggestions);
  const library = useStore((s) => s.library);
  const reviews = useStore((s) => s.reviews);
  const reference = useStore((s) => s.reference);
  const claudeEnabled = useStore((s) => s.claudeEnabled);
  const busy = useStore((s) => s.busy);
  const generateSuggestions = useStore((s) => s.generateSuggestions);
  const acceptSuggestion = useStore((s) => s.acceptSuggestion);
  const dismissSuggestion = useStore((s) => s.dismissSuggestion);
  const reviewRoom = useStore((s) => s.reviewRoom);

  const setPalette = async (paletteKey: string | null) => {
    const id = useStore.getState().project?.id;
    if (!id) return;
    await api.updateProject(id, { paletteKey });
    await useStore.getState().refreshProject();
  };

  const [designNote, setDesignNote] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    if (room && !reviews[room.id]) reviewRoom(room.id);
    setDesignNote(null);
  }, [room?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const libraryById = useMemo(() => new Map(library.map((l) => [l.id, l])), [library]);
  const roomSuggestions = useMemo(
    () => suggestions.filter((s) => s.roomId === room?.id),
    [suggestions, room?.id],
  );
  const open = roomSuggestions.filter((s) => s.status === 'open');
  const decided = roomSuggestions.filter((s) => s.status !== 'open');
  const review = room ? reviews[room.id] : undefined;

  if (!project) return <Empty title="No project yet">Create one to start planning.</Empty>;
  if (!room) return <Empty title="No room selected">Add a room from the sidebar.</Empty>;

  const generate = async () => {
    const note = await generateSuggestions(room.id);
    setDesignNote(note);
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="spread wrap" style={{ gap: 14 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2>{room.name}</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {review?.summary ?? 'Run a review to score this room against the mid-century rule set.'}
            </p>
          </div>
          <div style={{ width: 168 }}>
            <ScoreDial score={review?.styleScore ?? 0} />
          </div>
        </div>

        <hr className="divider" />

        <div className="spread wrap" style={{ gap: 10 }}>
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="palette">Target palette</label>
            <select
              id="palette" value={project.paletteKey ?? ''}
              onChange={(e) => setPalette(e.target.value || null)}
            >
              <option value="">no palette chosen</option>
              {(reference?.palettes ?? []).map((p) => <option key={p.key} value={p.key}>{p.name} ({p.era})</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 7 }}>
            <button className="btn" onClick={() => reviewRoom(room.id)} disabled={busy[`review:${room.id}`]}>
              {busy[`review:${room.id}`] ? <><Spinner /> Reviewing…</> : 'Re-run review'}
            </button>
            <button className="btn accent" onClick={generate} disabled={busy[`suggest:${room.id}`]}>
              {busy[`suggest:${room.id}`] ? <><Spinner /> Working…</> : 'Generate the plan'}
            </button>
          </div>
        </div>

        {project.paletteKey && reference && (() => {
          const p = reference.palettes.find((x) => x.key === project.paletteKey);
          if (!p) return null;
          return (
            <div style={{ marginTop: 12 }}>
              <div className="palette-row">
                {[...p.dominant, ...p.secondary, ...p.accent].map((c, i) => <i key={i} style={{ background: c }} />)}
              </div>
              <p className="small muted" style={{ margin: '6px 0 0' }}>{p.notes}</p>
            </div>
          );
        })()}

        {!claudeEnabled && (
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            Running without an API key. The plan still comes out — the rule engine decides what to suggest and works out
            where each piece fits from real geometry. What you lose is the pass that rewrites it against your own saved
            items, so rationales stay generic.
          </p>
        )}
      </div>

      {designNote && (
        <div className="card" style={{ borderLeft: '3px solid var(--walnut)' }}>
          <h4 style={{ marginBottom: 6 }}>The plan, in short</h4>
          <p style={{ margin: 0 }}>{designNote}</p>
        </div>
      )}

      {open.length > 0 && ([1, 2, 3] as const).map((priority) => {
        const group = open.filter((s) => s.priority === priority);
        if (!group.length) return null;
        return (
          <div key={priority}>
            <h4 style={{ margin: '6px 0 9px' }}>{PRIORITY_LABEL[priority]}</h4>
            <div className="stack" style={{ gap: 9 }}>
              {group.map((s, i) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  index={i + 1}
                  libraryTitle={s.libraryItemId ? libraryById.get(s.libraryItemId)?.title : undefined}
                  busy={Boolean(busy[`accept:${s.id}`] || busy[`dismiss:${s.id}`])}
                  onAccept={() => acceptSuggestion(s.id)}
                  onDismiss={() => dismissSuggestion(s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {!open.length && (
        <Empty title={decided.length ? 'Everything here is decided' : 'No plan yet'}>
          {decided.length
            ? 'Generate again after you change the room and it will pick up where things now stand.'
            : 'Press "Generate the plan" and the rule engine will work out what this room is missing, where each piece physically fits, and which of your saved items can fill the gaps.'}
        </Empty>
      )}

      {decided.length > 0 && (
        <div>
          <button className="btn ghost sm" onClick={() => setShowDismissed(!showDismissed)}>
            {showDismissed ? 'Hide' : 'Show'} {decided.length} decided item(s)
          </button>
          {showDismissed && (
            <div className="stack" style={{ gap: 9, marginTop: 9 }}>
              {decided.map((s) => (
                <SuggestionCard
                  key={s.id} suggestion={s} index={0}
                  libraryTitle={s.libraryItemId ? libraryById.get(s.libraryItemId)?.title : undefined}
                  busy={false}
                  onAccept={() => acceptSuggestion(s.id)}
                  onDismiss={() => dismissSuggestion(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {review && (
        <div className="card">
          <h4 style={{ marginBottom: 4 }}>Every rule, checked</h4>
          <p className="small muted" style={{ marginBottom: 6 }}>
            Measured from the room's actual geometry, so this says the same thing every time.
          </p>
          <FindingList findings={review.findings} />
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion, index, libraryTitle, busy, onAccept, onDismiss,
}: {
  suggestion: Suggestion; index: number; libraryTitle?: string; busy: boolean;
  onAccept: () => void; onDismiss: () => void;
}) {
  const settled = suggestion.status !== 'open';
  return (
    <div className={`sugg p${suggestion.priority}${settled ? ' done' : ''}`}>
      <span className="num">{settled ? (suggestion.status === 'dismissed' ? '×' : '✓') : index}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="spread wrap" style={{ gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{suggestion.title}</strong>
          <div className="row" style={{ gap: 5 }}>
            {libraryTitle && <span className="pill teal">yours</span>}
            <span className={`pill${suggestion.effort === 'free' ? ' olive' : suggestion.effort === 'invest' ? ' ochre' : ''}`}>
              {EFFORT_LABEL[suggestion.effort]}
            </span>
          </div>
        </div>
        <p className="small" style={{ margin: '5px 0 0', color: 'var(--ink-2)' }}>{suggestion.rationale}</p>
        {libraryTitle && <p className="small muted" style={{ margin: '4px 0 0' }}>From your library: {libraryTitle}</p>}
        {!settled && (
          <div className="actions">
            <button className="btn sm primary" onClick={onAccept} disabled={busy}>
              {busy ? <Spinner /> : suggestion.catalogKey ? 'Place it in the room' : 'Mark as planned'}
            </button>
            <button className="btn sm ghost" onClick={onDismiss} disabled={busy}>Not for me</button>
          </div>
        )}
        {settled && <p className="small muted" style={{ margin: '5px 0 0' }}>{suggestion.status === 'dismissed' ? 'Dismissed — it will not come back when you regenerate.' : 'Placed in the room.'}</p>}
      </div>
    </div>
  );
}
