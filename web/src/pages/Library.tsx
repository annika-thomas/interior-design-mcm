import { useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { sampleImage } from '../lib/color';
import { Dropzone, Empty, Modal, Spinner, money } from '../components/common';
import type { LibraryItem } from '../types';

/**
 * Everything you have been saving — screenshots, videos, product links, notes.
 *
 * The point of this page is not storage; it is that each item gets read for
 * what is actually reusable about it, so the Design tab can say "use the
 * credenza you saved" instead of "buy a credenza".
 */
export function LibraryPage() {
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const tags = useStore((s) => s.libraryTags);
  const claudeEnabled = useStore((s) => s.claudeEnabled);
  const busy = useStore((s) => s.busy);
  const { refreshLibrary, patchLibrary, removeLibrary, analyzeLibraryItem, analyzeAllLibrary, toast } = useStore();

  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [kind, setKind] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detail, setDetail] = useState<LibraryItem | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.filter((it) => {
      if (kind && it.kind !== kind) return false;
      if (activeTag && !it.tags.includes(activeTag)) return false;
      if (!needle) return true;
      return `${it.title} ${it.notes} ${it.tags.join(' ')} ${it.analysis?.summary ?? ''}`.toLowerCase().includes(needle);
    });
  }, [library, query, activeTag, kind]);

  const unread = library.filter((l) => l.analysis?.engine !== 'claude').length;

  const uploadFiles = async (files: File[]) => {
    if (!project) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of files) {
        form.append('files', file);
        const sample = await sampleImage(file);
        form.append('dominantColors', JSON.stringify(sample?.dominantColors ?? []));
      }
      await api.addLibrary(project.id, form);
      await refreshLibrary();
      toast('success', `Saved ${files.length} item${files.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save those.');
    } finally {
      setUploading(false);
    }
  };

  if (!project) return <Empty title="No project yet">Create one to start a library.</Empty>;

  return (
    <div className="stack">
      <div className="card">
        <div className="spread wrap" style={{ marginBottom: 12 }}>
          <div>
            <h2>Saved inspiration</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {library.length} item{library.length === 1 ? '' : 's'}.
              {unread > 0 && ` ${unread} not read closely yet.`}
            </p>
          </div>
          <div className="row" style={{ gap: 7 }}>
            <button className="btn" onClick={() => setAdding(true)}>Add a link or note</button>
            {claudeEnabled && unread > 0 && (
              <button className="btn accent" onClick={analyzeAllLibrary} disabled={busy.analyzeAll}>
                {busy.analyzeAll ? <><Spinner /> Reading…</> : `Read ${Math.min(unread, 25)} item(s)`}
              </button>
            )}
          </div>
        </div>

        <Dropzone onFiles={uploadFiles} accept="image/*,video/*">
          {uploading ? (
            <div className="row" style={{ justifyContent: 'center' }}><Spinner /> Saving…</div>
          ) : (
            <>
              <strong>Drop screenshots, photos or video clips</strong>
              <div className="small" style={{ marginTop: 4 }}>
                Anything you have been collecting. Pinterest screenshots, a still from a video, a product shot.
              </div>
            </>
          )}
        </Dropzone>
      </div>

      {library.length > 0 && (
        <div className="card">
          <div className="row wrap" style={{ gap: 8, marginBottom: tags.length ? 10 : 0 }}>
            <input
              type="text" placeholder="Search your library…" value={query}
              onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 260 }}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }}>
              <option value="">all kinds</option>
              <option value="image">images</option>
              <option value="video">videos</option>
              <option value="product">products</option>
              <option value="note">notes</option>
            </select>
          </div>
          {tags.length > 0 && (
            <div className="row wrap" style={{ gap: 4 }}>
              {tags.map((t) => (
                <button key={t} className="tag" aria-pressed={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>{t}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {!filtered.length ? (
        <Empty title={library.length ? 'Nothing matches' : 'Library is empty'}>
          {library.length
            ? 'Try a different search or clear the filters.'
            : 'Drop in the images and videos you have been saving. The Design tab pulls from here, so the more that is in it, the more the plan is built from things you actually like.'}
        </Empty>
      ) : (
        <div className="lib-grid">
          {filtered.map((item) => (
            <LibraryCard
              key={item.id}
              item={item}
              busy={Boolean(busy[`analyze:${item.id}`])}
              canAnalyze={claudeEnabled}
              onOpen={() => setDetail(item)}
              onFavorite={() => patchLibrary(item.id, { favorite: !item.favorite })}
              onAnalyze={() => analyzeLibraryItem(item.id)}
              onDelete={() => removeLibrary(item.id)}
            />
          ))}
        </div>
      )}

      {adding && <AddLinkModal onClose={() => setAdding(false)} />}
      {detail && <DetailModal item={detail} onClose={() => setDetail(null)} onSave={(patch) => patchLibrary(detail.id, patch)} />}
    </div>
  );
}

function LibraryCard({
  item, busy, canAnalyze, onOpen, onFavorite, onAnalyze, onDelete,
}: {
  item: LibraryItem; busy: boolean; canAnalyze: boolean;
  onOpen: () => void; onFavorite: () => void; onAnalyze: () => void; onDelete: () => void;
}) {
  const a = item.analysis;
  return (
    <div className="lib-card">
      <div className="lib-thumb" onClick={onOpen} style={{ cursor: 'pointer' }}>
        {item.filename && item.mime?.startsWith('image/') ? (
          <img src={api.libraryUrl(item.id)} alt={item.title} loading="lazy" />
        ) : item.filename && item.mime?.startsWith('video/') ? (
          <video src={api.libraryUrl(item.id)} muted playsInline preload="metadata" />
        ) : (
          <span className="small" style={{ padding: 12, textAlign: 'center' }}>
            {item.kind === 'video' ? '▶ video link' : item.kind === 'product' ? '🔗 product link' : 'note'}
          </span>
        )}
      </div>
      <div className="lib-body">
        <h3 title={item.title}>{item.title}</h3>
        {a?.summary && <p className="small muted" style={{ margin: 0 }}>{a.summary.slice(0, 120)}{a.summary.length > 120 ? '…' : ''}</p>}
        {a?.paletteHexes && a.paletteHexes.length > 0 && (
          <div className="swatches">{a.paletteHexes.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
        )}
        {a && (
          <div className="mcm-meter" title="How squarely this sits in the mid-century idiom">
            <span>MCM</span>
            <span className="bar"><i style={{ width: `${a.mcmScore}%` }} /></span>
            <span>{a.mcmScore}</span>
          </div>
        )}
        <div className="row wrap" style={{ gap: 4, marginTop: 'auto' }}>
          <button className="btn ghost sm" onClick={onFavorite} title="Favourite">{item.favorite ? '★' : '☆'}</button>
          {canAnalyze && a?.engine !== 'claude' && (
            <button className="btn ghost sm" onClick={onAnalyze} disabled={busy}>{busy ? <Spinner /> : 'Read it'}</button>
          )}
          {item.url && <a className="btn ghost sm" href={item.url} target="_blank" rel="noreferrer noopener">Open</a>}
          <button className="btn ghost sm danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>×</button>
        </div>
      </div>
    </div>
  );
}

function AddLinkModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const { refreshLibrary, toast } = useStore();
  const [urls, setUrls] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const form = new FormData();
      const list = urls.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
      form.append('urls', JSON.stringify(list));
      if (title) form.append('title', title);
      if (notes) form.append('notes', notes);
      if (tags) form.append('tags', JSON.stringify(tags.split(',').map((t) => t.trim()).filter(Boolean)));
      if (price) form.append('priceCents', String(Math.round(Number(price) * 100)));
      await api.addLibrary(project.id, form);
      await refreshLibrary();
      toast('success', list.length ? `Saved ${list.length} link(s).` : 'Note saved.');
      onClose();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add links or a note" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="lib-urls">Links</label>
          <textarea
            id="lib-urls" value={urls} onChange={(e) => setUrls(e.target.value)}
            placeholder="One per line. Product pages, YouTube or TikTok videos, articles…"
          />
        </div>
        <div className="field">
          <label htmlFor="lib-title">Title <span className="muted">(optional)</span></label>
          <input id="lib-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Left blank, it is taken from the URL" />
        </div>
        <div className="field">
          <label htmlFor="lib-notes">Note</label>
          <textarea id="lib-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you liked about it. This is fed into the plan, so be specific." />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="lib-tags">Tags</label>
            <input id="lib-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="sofa, walnut" />
          </div>
          <div className="field">
            <label htmlFor="lib-price">Price</label>
            <input id="lib-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1200" />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving || (!urls.trim() && !notes.trim())}>
            {saving ? <><Spinner /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ item, onClose, onSave }: { item: LibraryItem; onClose: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const [notes, setNotes] = useState(item.notes);
  const a = item.analysis;
  return (
    <Modal title={item.title} onClose={onClose} wide>
      <div className="stack">
        {item.filename && item.mime?.startsWith('image/') && (
          <img src={api.libraryUrl(item.id)} alt="" style={{ width: '100%', borderRadius: 8 }} />
        )}
        {item.filename && item.mime?.startsWith('video/') && (
          <video src={api.libraryUrl(item.id)} controls style={{ width: '100%', borderRadius: 8 }} />
        )}
        {item.url && <a href={item.url} target="_blank" rel="noreferrer noopener" className="small">{item.url}</a>}
        {money(item.priceCents) && <p className="small">Price: {money(item.priceCents)}</p>}

        {a && (
          <>
            <div>
              <h4>Read as</h4>
              <p className="small">{a.summary}</p>
              {a.formNotes && <p className="small muted">{a.formNotes}</p>}
            </div>
            {a.takeaways.length > 0 && (
              <div>
                <h4>What to steal from it</h4>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {a.takeaways.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
            <div className="row wrap" style={{ gap: 6 }}>
              {a.roleGuess && <span className="pill olive">fills: {a.roleGuess}</span>}
              {a.era && <span className="pill">{a.era}</span>}
              <span className="pill">MCM {a.mcmScore}/100</span>
              {a.materials.map((m) => <span key={m} className="pill">{m}</span>)}
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="detail-notes">Your note</label>
          <textarea id="detail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={() => { onSave({ notes }); onClose(); }}>Save note</button>
        </div>
      </div>
    </Modal>
  );
}
