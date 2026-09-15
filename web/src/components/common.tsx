import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { Finding } from '../types';

export function Spinner() {
  return <span className="spinner" aria-label="Working" />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/** Score colour follows the rule engine's own thresholds rather than a gradient. */
export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--olive)';
  if (score >= 55) return 'var(--ochre)';
  return 'var(--accent)';
}

export function ScoreDial({ score, label }: { score: number; label?: string }) {
  return (
    <div>
      <div className="score">
        <b style={{ color: scoreColor(score) }}>{score}</b>
        <span className="muted small">/ 100 {label}</span>
      </div>
      <div className="score-bar" style={{ marginTop: 6 }}>
        <i style={{ width: `${Math.max(2, score)}%`, background: scoreColor(score) }} />
      </div>
    </div>
  );
}

export function FindingList({ findings }: { findings: Finding[] }) {
  // Failures first — the list exists to tell you what to fix, not to reassure.
  const order = { fail: 0, unknown: 1, pass: 2 } as const;
  const sorted = [...findings].sort(
    (a, b) => order[a.status] - order[b.status] || (a.severity === 'major' ? -1 : 1),
  );
  return (
    <div>
      {sorted.map((f) => (
        <div className="finding" key={f.ruleKey}>
          <span className={`dot ${f.status === 'fail' && f.severity !== 'major' ? 'minor' : f.status}`} />
          <div style={{ minWidth: 0 }}>
            <div className="spread" style={{ gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{f.title}</strong>
              <span className="pill">{f.category}</span>
            </div>
            <div className="small" style={{ color: 'var(--ink-2)' }}>{f.detail}</div>
            {f.status === 'fail' && <div className="small" style={{ color: 'var(--ink-3)', marginTop: 3 }}>{f.fix}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Dropzone({
  onFiles, accept, children, multiple = true,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  children: ReactNode;
  multiple?: boolean;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback((list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  }, [onFiles]);

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      style={{ cursor: 'pointer' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => { handle(e.target.files); e.target.value = ''; }}
      />
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(43,41,38,.42)', zIndex: 60,
        display: 'grid', placeItems: 'center', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: wide ? 760 : 480, maxWidth: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: 'var(--shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const cm = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} cm`);
export const money = (cents: number | null | undefined) =>
  cents == null ? null : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
