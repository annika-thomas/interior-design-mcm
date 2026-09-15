import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore, useActiveRoom } from '../store';
import { sampleImage } from '../lib/color';
import { Dropzone, Empty, Spinner } from '../components/common';
import type { CapturePlanStep, CaptureTag, Photo } from '../types';

const TAG_OPTIONS: CaptureTag[] = [
  'wide', 'wall-north', 'wall-east', 'wall-south', 'wall-west',
  'corner', 'window', 'door', 'floor', 'ceiling', 'detail', 'untagged',
];

/** Best guess at what a photo shows, from its filename. */
function guessTag(name: string): CaptureTag {
  const n = name.toLowerCase();
  for (const tag of TAG_OPTIONS) if (n.includes(tag.replace('wall-', ''))) return tag;
  if (/wide|pano|room/.test(n)) return 'wide';
  return 'untagged';
}

export function SurveyPage() {
  const project = useStore((s) => s.project);
  const room = useActiveRoom();
  const photos = useStore((s) => s.photos);
  const claudeEnabled = useStore((s) => s.claudeEnabled);
  const busy = useStore((s) => s.busy);
  const { refreshPhotos, patchPhoto, removePhoto, runSurvey, toast } = useStore();

  const [plan, setPlan] = useState<CapturePlanStep[]>([]);
  const [uploading, setUploading] = useState(0);
  const [importFurniture, setImportFurniture] = useState(true);

  useEffect(() => { api.capturePlan().then(setPlan).catch(() => setPlan([])); }, []);

  const roomPhotos = useMemo(
    () => photos.filter((p) => p.roomId === room?.id),
    [photos, room?.id],
  );
  const unassigned = useMemo(() => photos.filter((p) => !p.roomId), [photos]);

  const coverage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of roomPhotos) counts.set(p.captureTag, (counts.get(p.captureTag) ?? 0) + 1);
    // "Each wall, straight on" is satisfied by any of the four wall tags.
    const wallShots = ['wall-north', 'wall-east', 'wall-south', 'wall-west']
      .reduce((s, t) => s + (counts.get(t) ?? 0), 0);
    return plan.map((step) => ({
      ...step,
      have: step.tag === 'wall-north' ? wallShots : counts.get(step.tag) ?? 0,
    }));
  }, [roomPhotos, plan]);

  const upload = async (files: File[]) => {
    if (!project) return;
    setUploading(files.length);
    try {
      const form = new FormData();
      // Sampling the pixels here means every photo arrives with real wall and
      // floor colours even when no API key is configured.
      for (const file of files) {
        form.append('photos', file);
        form.append('captureTags', guessTag(file.name));
        const sample = await sampleImage(file);
        form.append('dominantColors', JSON.stringify(sample?.dominantColors ?? []));
        form.append('brightness', String(sample?.brightness ?? ''));
      }
      if (room) form.append('roomId', room.id);
      await api.uploadPhotos(project.id, form);
      await refreshPhotos();
      toast('success', `Added ${files.length} photo${files.length === 1 ? '' : 's'}${room ? ` to ${room.name}` : ''}.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(0);
    }
  };

  if (!project) return <Empty title="No project yet">Create one from the bar above to start.</Empty>;

  return (
    <div className="stack">
      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <h2>Survey {room ? room.name : 'your apartment'}</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Photograph the room the way the checklist asks. Coverage matters far more than photo quality —
              a blurry shot of a doorframe is worth more here than a beautiful one of a corner, because the
              door is what sets the scale for everything else.
            </p>
          </div>
        </div>

        <Dropzone onFiles={upload} accept="image/*">
          {uploading ? (
            <div className="row" style={{ justifyContent: 'center' }}><Spinner /> Uploading {uploading}…</div>
          ) : (
            <>
              <strong>Drop photos here</strong>
              <div className="small" style={{ marginTop: 4 }}>
                or click to browse. JPEG, PNG, WebP and HEIC. Shoot the whole room in one go — dozens at a time is fine.
              </div>
            </>
          )}
        </Dropzone>
      </div>

      {room && (
        <div className="card">
          <h4 style={{ marginBottom: 10 }}>Capture checklist — {room.name}</h4>
          <div className="checklist">
            {coverage.map((step) => (
              <div key={step.tag} className={`checklist-item${step.have >= step.min ? ' done' : ''}`}>
                <span className="box">{step.have >= step.min ? '✓' : ''}</span>
                <div>
                  <div><strong>{step.label}</strong> <span className="muted small">{step.have}/{Math.max(step.min, 1)}</span></div>
                  <div className="small muted">{step.why}</div>
                </div>
              </div>
            ))}
          </div>

          <hr className="divider" />

          <div className="spread wrap" style={{ gap: 12 }}>
            <label className="row small" style={{ gap: 7 }}>
              <input
                type="checkbox"
                checked={importFurniture}
                onChange={(e) => setImportFurniture(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Also add the furniture it finds to the room
            </label>
            <button
              className="btn accent"
              disabled={!roomPhotos.length || busy[`survey:${room.id}`]}
              onClick={() => runSurvey(room.id, { importFurniture, applyDimensions: true, applyOpenings: true })}
            >
              {busy[`survey:${room.id}`] ? <><Spinner /> Surveying…</> : `Survey ${room.name} from ${roomPhotos.length} photo${roomPhotos.length === 1 ? '' : 's'}`}
            </button>
          </div>

          {!claudeEnabled && (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              No <span className="mono">ANTHROPIC_API_KEY</span> is set, so the survey button will not run. Photos are still
              stored and colour-sampled, and you can enter the room's real dimensions by hand on the Plan tab — which is
              more accurate than any estimate anyway if you have a tape measure to hand.
            </p>
          )}
          {room.analysis && (
            <p className="small" style={{ margin: '10px 0 0', color: 'var(--ink-2)' }}>{room.analysis.summary}</p>
          )}
        </div>
      )}

      <PhotoSection
        title={room ? `${room.name} — ${roomPhotos.length} photo${roomPhotos.length === 1 ? '' : 's'}` : 'Photos'}
        photos={roomPhotos}
        onTag={(id, tag) => patchPhoto(id, { captureTag: tag })}
        onRoom={(id, roomId) => patchPhoto(id, { roomId })}
        onDelete={removePhoto}
      />

      {unassigned.length > 0 && (
        <PhotoSection
          title={`Not assigned to a room — ${unassigned.length}`}
          note="Assign each of these to a room so it counts toward that room's survey."
          photos={unassigned}
          onTag={(id, tag) => patchPhoto(id, { captureTag: tag })}
          onRoom={(id, roomId) => patchPhoto(id, { roomId })}
          onDelete={removePhoto}
        />
      )}
    </div>
  );
}

function PhotoSection({
  title, note, photos, onTag, onRoom, onDelete,
}: {
  title: string;
  note?: string;
  photos: Photo[];
  onTag: (id: string, tag: string) => void;
  onRoom: (id: string, roomId: string) => void;
  onDelete: (id: string) => void;
}) {
  const rooms = useStore((s) => s.project?.rooms ?? []);
  const [inspect, setInspect] = useState<Photo | null>(null);

  if (!photos.length) return null;

  return (
    <div className="card">
      <h4 style={{ marginBottom: note ? 4 : 10 }}>{title}</h4>
      {note && <p className="small muted" style={{ marginBottom: 10 }}>{note}</p>}
      <div className="photo-grid">
        {photos.map((p) => (
          <div className="photo" key={p.id}>
            <img src={api.photoUrl(p.id)} alt={p.originalName} loading="lazy" onClick={() => setInspect(p)} />
            <button className="kill" onClick={() => onDelete(p.id)} title="Remove">×</button>
            <div className="overlay">
              <select value={p.captureTag} onChange={(e) => onTag(p.id, e.target.value)} onClick={(e) => e.stopPropagation()}>
                {TAG_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={p.roomId ?? ''} onChange={(e) => onRoom(p.id, e.target.value)} onClick={(e) => e.stopPropagation()}>
                <option value="">no room</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>

      {inspect && <PhotoDetail photo={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}

function PhotoDetail({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const a = photo.analysis;
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(43,41,38,.6)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 880, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2>{photo.originalName}</h2>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <img src={api.photoUrl(photo.id)} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 14 }} />
        {!a ? <p className="muted small">Not analyzed yet.</p> : (
          <div className="stack">
            <div>
              <h4>What it shows</h4>
              <p className="small">{a.summary}</p>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              {a.wallColor && <span className="pill"><i style={{ width: 11, height: 11, borderRadius: 2, background: a.wallColor, display: 'inline-block' }} /> wall {a.wallColor}</span>}
              {a.floorColor && <span className="pill"><i style={{ width: 11, height: 11, borderRadius: 2, background: a.floorColor, display: 'inline-block' }} /> floor {a.floorColor}</span>}
              {a.floorMaterial && <span className="pill">{a.floorMaterial}</span>}
              {a.colorTemperature && <span className={`pill${a.colorTemperature === 'cool' ? ' accent' : ''}`}>{a.colorTemperature} light</span>}
              <span className="pill">{a.engine === 'claude' ? 'vision' : 'colour sample only'}</span>
            </div>
            {a.dimensions?.widthCm != null && (
              <div>
                <h4>Estimated room size</h4>
                <p className="small">
                  {Math.round(a.dimensions.widthCm)} × {Math.round(a.dimensions.depthCm ?? 0)} × {Math.round(a.dimensions.heightCm ?? 0)} cm
                  {' · '}<span className="muted">{a.dimensions.confidence} confidence, scaled from {a.dimensions.scaleAnchor ?? 'unknown reference'}</span>
                </p>
              </div>
            )}
            {a.existingFurniture.length > 0 && (
              <div>
                <h4>Furniture in this shot</h4>
                {a.existingFurniture.map((f, i) => (
                  <div key={i} className="finding">
                    <span className={`dot ${f.mcmVerdict === 'keeper' ? 'pass' : f.mcmVerdict === 'clashes' ? 'fail' : 'minor'}`} />
                    <div>
                      <strong style={{ fontSize: 13 }}>{f.label}</strong>{' '}
                      <span className="pill">{f.mcmVerdict}</span>
                      <div className="small" style={{ color: 'var(--ink-2)' }}>{f.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {a.warnings.length > 0 && (
              <div>
                <h4>Caveats</h4>
                <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                  {a.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
