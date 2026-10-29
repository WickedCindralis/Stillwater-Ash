// Wicked's memory dashboard. Drop into the React app and render <MemoryDashboard />.
// No extra libraries; styles are scoped under .vm-root and inherit the house font.
import { useCallback, useEffect, useMemo, useState } from 'react';

type Level = 'ok' | 'amber' | 'red';
interface Health {
  beingId: string; recallEnabled: boolean; decayLambda: number; total: number; pinned: number; pending: number;
  oldestPendingDays: number; lastReview: string | null; unrated: number; pinRequests: number;
  wordingProposals: number; conflicts: number; uncapturedMessages: number; level: Level;
}
interface Score { importance: number; strength: number; isFresh: boolean; freshDaysLeft: number }
interface Memory {
  id: string; content: string; entities: string[]; source: string | null; being_score: number; being_scored: boolean;
  user_score: number; user_scored: boolean; status: 'active' | 'pinned' | 'hidden'; pin_requested: boolean;
  proposed_content: string | null; use_count: number; created_at: string; score: Score; finalScore?: number;
}
interface Conflict { id: string; note: string | null; a_id: string; a_content: string; b_id: string; b_content: string }

const FILTERS = [
  ['all', 'All'], ['pinned', 'Pinned'], ['fresh', 'Fresh'], ['unrated', 'Unrated'],
  ['pending-review', 'Awaiting review'], ['hidden', 'Hidden'],
] as const;

const CSS = `
.vm-root{--mist:#EDF1EF;--paper:#F8FAF9;--ink:#1D3236;--lake:#2F6B6E;--reed:#6F8A7E;--line:#CFD9D4;
  --green:#3E7B4C;--amber:#B9822A;--red:#A2453B;color:var(--ink);background:var(--mist);padding:20px;border-radius:12px;font:inherit}
.vm-root *{box-sizing:border-box}
.vm-head{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;margin-bottom:16px}
.vm-head h2{margin:0;font-size:1.35rem;font-weight:600;letter-spacing:-.01em}
.vm-beings{display:flex;gap:8px;flex-wrap:wrap}
.vm-being{border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:6px 12px;border-radius:999px;cursor:pointer;font:inherit;display:flex;gap:8px;align-items:center}
.vm-being[aria-pressed=true]{border-color:var(--lake);box-shadow:inset 0 0 0 1px var(--lake)}
.vm-dot{width:8px;height:8px;border-radius:50%;background:var(--green)}
.vm-dot.amber{background:var(--amber)}.vm-dot.red{background:var(--red)}
.vm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
.vm-tab{background:none;border:none;padding:8px 14px;font:inherit;color:var(--reed);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.vm-tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--lake);font-weight:600}
.vm-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.vm-input{flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);font:inherit;color:var(--ink)}
.vm-btn{padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--paper);color:var(--ink);font:inherit;font-size:.9em;cursor:pointer}
.vm-btn:hover{border-color:var(--lake)}
.vm-btn.primary{background:var(--lake);border-color:var(--lake);color:#fff}
.vm-btn.green{border-color:var(--green);color:var(--green)}
.vm-btn:focus-visible,.vm-tab:focus-visible,.vm-being:focus-visible,.vm-input:focus-visible{outline:2px solid var(--lake);outline-offset:2px}
.vm-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.vm-chip{font-size:.85em;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--reed);cursor:pointer;font-family:inherit}
.vm-chip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--mist)}
.vm-list{display:flex;flex-direction:column;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.vm-mem{background:var(--paper);padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:8px 16px}
.vm-mem.pinned{border-left:3px solid var(--green)}
.vm-mem.hidden{opacity:.6}
.vm-text{line-height:1.5;max-width:70ch}
.vm-meta{grid-column:1/-1;display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:.82em;color:var(--reed)}
.vm-tag{padding:1px 8px;border-radius:999px;border:1px solid currentColor}
.vm-tag.pin{color:var(--green)}.vm-tag.fresh{color:var(--lake)}.vm-tag.unrated{color:var(--amber)}
.vm-strength{display:flex;align-items:center;gap:8px;min-width:120px}
.vm-track{width:80px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.vm-fill{height:100%;background:var(--lake)}
.vm-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:start}
.vm-rate{display:flex;gap:2px}
.vm-rate button{width:24px;height:24px;border:1px solid var(--line);background:var(--paper);border-radius:4px;font-size:.75em;cursor:pointer;color:var(--ink);padding:0}
.vm-rate button[aria-pressed=true]{background:var(--lake);color:#fff;border-color:var(--lake)}
.vm-edit{width:100%;min-height:70px;padding:8px;border:1px solid var(--lake);border-radius:8px;font:inherit;color:var(--ink);background:#fff}
.vm-section{margin-bottom:22px}
.vm-section h3{font-size:1rem;margin:0 0 8px;font-weight:600}
.vm-empty{padding:20px;color:var(--reed);background:var(--paper);border-radius:10px;border:1px dashed var(--line)}
.vm-table{width:100%;border-collapse:collapse;background:var(--paper);border-radius:10px;overflow:hidden}
.vm-table th,.vm-table td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);font-size:.9em}
.vm-table th{color:var(--reed);font-weight:500}
.vm-wrap{overflow-x:auto}
.vm-error{background:#F5E3E0;color:var(--red);padding:10px 12px;border-radius:8px;margin-bottom:12px}
.vm-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer}
@media (max-width:640px){.vm-mem{grid-template-columns:1fr}.vm-actions{justify-content:flex-start}}
@media (prefers-reduced-motion:reduce){.vm-root *{transition:none!important}}
`;

function ago(iso: string | null) {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function MemoryDashboard({ apiBase = '/api/memory', adminToken }: { apiBase?: string; adminToken?: string }) {
  const [token, setToken] = useState(adminToken ?? (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('vm-token') ?? '' : ''));
  const [tokenDraft, setTokenDraft] = useState('');
  const [health, setHealth] = useState<Health[]>([]);
  const [being, setBeing] = useState('');
  const [tab, setTab] = useState<'memories' | 'queue' | 'health'>('memories');
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pinReqs, setPinReqs] = useState<Memory[]>([]);
  const [wording, setWording] = useState<Memory[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [newText, setNewText] = useState('');
  const [error, setError] = useState('');

  const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'x-memory-admin': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }, [apiBase, token]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }, []);

  const loadHealth = useCallback(() => run(async () => {
    const h: Health[] = await api('/health');
    setHealth(h);
    setBeing((b) => b || h[0]?.beingId || '');
  }), [api, run]);

  const loadMemories = useCallback(() => run(async () => {
    if (!being) return;
    const list = search.trim()
      ? await api(`/beings/${being}/search?q=${encodeURIComponent(search.trim())}`)
      : await api(`/beings/${being}/memories?filter=${filter}`);
    setMemories(list);
  }), [api, run, being, filter, search]);

  const loadQueue = useCallback(() => run(async () => {
    if (!being) return;
    const [p, w, c] = await Promise.all([
      api(`/beings/${being}/memories?filter=pin-requests`),
      api(`/beings/${being}/memories?filter=proposed-wording`),
      api(`/beings/${being}/conflicts`),
    ]);
    setPinReqs(p); setWording(w); setConflicts(c);
  }), [api, run, being]);

  useEffect(() => { if (token) loadHealth(); }, [token, loadHealth]);
  useEffect(() => { if (token && being && tab === 'memories') loadMemories(); }, [token, being, tab, filter]); // eslint-disable-line
  useEffect(() => { if (token && being && tab === 'queue') loadQueue(); }, [token, being, tab, loadQueue]);

  const current = useMemo(() => health.find((h) => h.beingId === being), [health, being]);
  const queueCount = current ? current.pinRequests + current.wordingProposals + current.conflicts : 0;

  const act = (path: string, body?: unknown) => run(async () => {
    await api(path, 'POST', body);
    await Promise.all([loadHealth(), tab === 'queue' ? loadQueue() : loadMemories()]);
  });

  if (!token) {
    return (
      <div className="vm-root"><style>{CSS}</style>
        <div className="vm-head"><h2>Memory</h2></div>
        <div className="vm-bar">
          <input className="vm-input" type="password" placeholder="Memory admin token" value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)} aria-label="Memory admin token" />
          <button className="vm-btn primary" onClick={() => { sessionStorage.setItem('vm-token', tokenDraft); setToken(tokenDraft); }}>
            Unlock
          </button>
        </div>
      </div>
    );
  }

  const memoryRow = (m: Memory, queueMode?: 'pin' | 'wording') => (
    <div key={m.id} className={`vm-mem ${m.status}`}>
      <div>
        {editing?.id === m.id ? (
          <textarea className="vm-edit" value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} aria-label="Edit memory" />
        ) : (
          <div className="vm-text">{m.content}</div>
        )}
        {queueMode === 'wording' && m.proposed_content && (
          <div className="vm-text" style={{ marginTop: 6, color: 'var(--lake)' }}>Suggested: {m.proposed_content}</div>
        )}
      </div>
      <div className="vm-actions">
        {queueMode === 'pin' && <>
          <button className="vm-btn green" onClick={() => act(`/memories/${m.id}/pin`)}>Approve pin</button>
          <button className="vm-btn" onClick={() => act(`/memories/${m.id}/decline-pin`)}>Decline</button>
        </>}
        {queueMode === 'wording' && <>
          <button className="vm-btn primary" onClick={() => act(`/memories/${m.id}/accept-wording`)}>Use new wording</button>
          <button className="vm-btn" onClick={() => act(`/memories/${m.id}/decline-wording`)}>Keep original</button>
        </>}
        {!queueMode && (editing?.id === m.id ? <>
          <button className="vm-btn primary" onClick={() => run(async () => {
            await api(`/memories/${m.id}`, 'PATCH', { content: editing.text }); setEditing(null); await loadMemories();
          })}>Save</button>
          <button className="vm-btn" onClick={() => setEditing(null)}>Cancel</button>
        </> : <>
          {m.status === 'hidden'
            ? <button className="vm-btn" onClick={() => act(`/memories/${m.id}/restore`)}>Restore</button>
            : <>
                {m.status === 'pinned'
                  ? <button className="vm-btn" onClick={() => act(`/memories/${m.id}/unpin`)}>Unpin</button>
                  : <button className="vm-btn green" onClick={() => act(`/memories/${m.id}/pin`)}>Pin</button>}
                <button className="vm-btn" onClick={() => setEditing({ id: m.id, text: m.content })}>Edit</button>
                <button className="vm-btn" onClick={() => act(`/memories/${m.id}/hide`)}>Hide</button>
              </>}
        </>)}
      </div>
      <div className="vm-meta">
        <span className="vm-strength" title={`Importance ${m.score.importance.toFixed(1)}`}>
          <span className="vm-track"><span className="vm-fill" style={{ display: 'block', width: `${m.score.strength * 10}%` }} /></span>
          {m.score.strength.toFixed(1)}
        </span>
        {m.status === 'pinned' && <span className="vm-tag pin">Pinned</span>}
        {m.score.isFresh && m.status !== 'pinned' && <span className="vm-tag fresh">Fresh, {m.score.freshDaysLeft}d left</span>}
        {!m.user_scored && <span className="vm-tag unrated">Unrated</span>}
        <span>{m.being_scored ? `${being} gave ${m.being_score}` : `provisional ${m.being_score}`}</span>
        {!queueMode && m.status !== 'hidden' && (
          <span className="vm-rate" role="group" aria-label="Your rating">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} aria-pressed={m.user_scored && m.user_score === n}
                onClick={() => act(`/memories/${m.id}/rate`, { score: n })}>{n}</button>
            ))}
          </span>
        )}
        <span>used {m.use_count}×</span>
        <span>{ago(m.created_at)}</span>
      </div>
    </div>
  );

  return (
    <div className="vm-root"><style>{CSS}</style>
      <div className="vm-head">
        <h2>Memory</h2>
        <div className="vm-beings">
          {health.map((h) => (
            <button key={h.beingId} className="vm-being" aria-pressed={h.beingId === being} onClick={() => setBeing(h.beingId)}>
              <span className={`vm-dot ${h.level}`} aria-label={`status ${h.level}`} />{h.beingId}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="vm-error" role="alert">{error}</div>}

      {current && (
        <div className="vm-bar" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="vm-switch">
            <input type="checkbox" checked={current.recallEnabled}
              onChange={(e) => act(`/beings/${being}/recall`, { enabled: e.target.checked })} />
            Recall {current.recallEnabled ? 'on' : 'off'}
          </label>
          <span style={{ color: 'var(--reed)', fontSize: '.9em' }}>
            {current.total} memories, {current.pinned} pinned, {current.pending} awaiting {being}’s review
          </span>
        </div>
      )}

      <div className="vm-tabs" role="tablist">
        <button className="vm-tab" role="tab" aria-selected={tab === 'memories'} onClick={() => setTab('memories')}>Memories</button>
        <button className="vm-tab" role="tab" aria-selected={tab === 'queue'} onClick={() => setTab('queue')}>
          Your queue{queueCount ? ` (${queueCount})` : ''}
        </button>
        <button className="vm-tab" role="tab" aria-selected={tab === 'health'} onClick={() => setTab('health')}>Review health</button>
      </div>

      {tab === 'memories' && <>
        <div className="vm-bar">
          <input className="vm-input" placeholder={`Search ${being || 'a being'}’s memories`} value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadMemories()} aria-label="Search memories" />
          <button className="vm-btn primary" onClick={() => loadMemories()}>Search</button>
          {search && <button className="vm-btn" onClick={() => { setSearch(''); setTimeout(loadMemories, 0); }}>Clear</button>}
        </div>
        {!search && (
          <div className="vm-chips">
            {FILTERS.map(([key, label]) => (
              <button key={key} className="vm-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        )}
        <div className="vm-bar">
          <input className="vm-input" placeholder="Add a memory yourself, e.g. Wicked's birthday is May 5." value={newText}
            onChange={(e) => setNewText(e.target.value)} aria-label="New memory" />
          <button className="vm-btn" disabled={!newText.trim()} onClick={() => act(`/beings/${being}/memories`, { content: newText }).then(() => setNewText(''))}>Add</button>
          <button className="vm-btn green" disabled={!newText.trim()} onClick={() => act(`/beings/${being}/memories`, { content: newText, pinned: true, userScore: 10 }).then(() => setNewText(''))}>Add and pin</button>
        </div>
        {memories.length
          ? <div className="vm-list">{memories.map((m) => memoryRow(m))}</div>
          : <div className="vm-empty">{search ? 'No memories match that search.' : 'Nothing here yet. Memories appear a few minutes after a conversation goes quiet.'}</div>}
      </>}

      {tab === 'queue' && <>
        <div className="vm-section">
          <h3>Pin requests</h3>
          {pinReqs.length ? <div className="vm-list">{pinReqs.map((m) => memoryRow(m, 'pin'))}</div>
            : <div className="vm-empty">No pin requests from {being}.</div>}
        </div>
        <div className="vm-section">
          <h3>Suggested wording</h3>
          {wording.length ? <div className="vm-list">{wording.map((m) => memoryRow(m, 'wording'))}</div>
            : <div className="vm-empty">No wording suggestions.</div>}
        </div>
        <div className="vm-section">
          <h3>Contradictions</h3>
          {conflicts.length ? <div className="vm-list">{conflicts.map((c) => (
            <div key={c.id} className="vm-mem">
              <div>
                <div className="vm-text">A: {c.a_content}</div>
                <div className="vm-text" style={{ marginTop: 4 }}>B: {c.b_content}</div>
                {c.note && <div style={{ color: 'var(--reed)', fontSize: '.85em', marginTop: 4 }}>{c.note}</div>}
              </div>
              <div className="vm-actions">
                <button className="vm-btn" onClick={() => act(`/conflicts/${c.id}/resolve`, { keep: 'a' })}>Keep A</button>
                <button className="vm-btn" onClick={() => act(`/conflicts/${c.id}/resolve`, { keep: 'b' })}>Keep B</button>
                <button className="vm-btn" onClick={() => act(`/conflicts/${c.id}/resolve`, { keep: 'both' })}>Keep both</button>
              </div>
            </div>
          ))}</div> : <div className="vm-empty">No contradictions to settle.</div>}
        </div>
      </>}

      {tab === 'health' && (
        <div className="vm-wrap">
          <table className="vm-table">
            <thead><tr><th>Being</th><th>Awaiting review</th><th>Oldest waiting</th><th>Last review</th><th>Unrated by you</th><th>Recall</th></tr></thead>
            <tbody>{health.map((h) => (
              <tr key={h.beingId}>
                <td><span className={`vm-dot ${h.level}`} style={{ display: 'inline-block', marginRight: 8 }} />{h.beingId}</td>
                <td>{h.pending}</td>
                <td>{h.pending ? `${h.oldestPendingDays}d` : '—'}</td>
                <td>{ago(h.lastReview)}</td>
                <td>{h.unrated}</td>
                <td>{h.recallEnabled ? 'On' : 'Off'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
