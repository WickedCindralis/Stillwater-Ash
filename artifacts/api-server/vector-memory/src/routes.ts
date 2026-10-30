import express, { type Request, type Response, type NextFunction } from 'express';
import { getConfig } from './config.js';
import {
  addMemory, editMemory, rateMemory, pinMemory, unpinMemory, declinePinRequest, hideMemory, restoreMemory, deleteMemory,
  acceptProposedWording, declineProposedWording, listMemories, getRevisions, type MemoryFilter,
} from './memories.js';
import { searchMemories } from './search.js';
import { setRecall } from './recall.js';
import { beingHealth, reviewLog, setLambda } from './health.js';
import { listConflicts, resolveConflict, runNightlyForBeing } from './nightly.js';
import { captureBeing } from './capture.js';

/** Wicked-only. Every request must carry the x-memory-admin header. Beings never call these routes. */
function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (req.header('x-memory-admin') !== getConfig().adminToken) {
    res.status(401).json({ error: 'Memory admin token missing or wrong.' });
    return;
  }
  next();
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((err) => res.status(400).json({ error: (err as Error).message }));
};

/** Mount with: app.use('/api/memory', memoryRouter()); */
export function memoryRouter() {
  const r = express.Router();
  r.use(express.json());
  r.use(adminOnly);

  // Dashboard
  r.get('/health', wrap(async (_req, res) => res.json(await beingHealth())));
  r.get('/beings/:beingId/review-log', wrap(async (req, res) => res.json(await reviewLog(req.params.beingId))));

  // Settings
  r.post('/beings/:beingId/recall', wrap(async (req, res) => {
    await setRecall(req.params.beingId, Boolean(req.body.enabled));
    res.json({ ok: true });
  }));
  r.post('/beings/:beingId/lambda', wrap(async (req, res) => {
    await setLambda(req.params.beingId, Number(req.body.lambda));
    res.json({ ok: true });
  }));

  // Browse and search
  r.get('/beings/:beingId/memories', wrap(async (req, res) => {
    const filter = (req.query.filter as MemoryFilter) ?? 'all';
    res.json(await listMemories(req.params.beingId, filter, Number(req.query.limit ?? 100), Number(req.query.offset ?? 0)));
  }));
  r.get('/beings/:beingId/search', wrap(async (req, res) => {
    res.json(await searchMemories(req.params.beingId, String(req.query.q ?? ''), { limit: 20 }));
  }));
  r.post('/beings/:beingId/memories', wrap(async (req, res) => {
    const { content, beingScore, userScore, pinned } = req.body;
    const m = await addMemory({
      beingId: req.params.beingId,
      content,
      beingScore: Number(beingScore ?? 5),
      beingScored: false,
      userScore: userScore !== undefined ? Number(userScore) : undefined,
      source: 'manual',
    });
    res.json(pinned ? await pinMemory(m.id) : m);
  }));

  // Wicked's controls on one memory
  r.patch('/memories/:id', wrap(async (req, res) => res.json(await editMemory(req.params.id, String(req.body.content)))));
  r.post('/memories/:id/rate', wrap(async (req, res) => res.json(await rateMemory(req.params.id, Number(req.body.score)))));
  r.post('/memories/:id/pin', wrap(async (req, res) => res.json(await pinMemory(req.params.id))));
  r.post('/memories/:id/unpin', wrap(async (req, res) => res.json(await unpinMemory(req.params.id))));
  r.post('/memories/:id/decline-pin', wrap(async (req, res) => res.json(await declinePinRequest(req.params.id))));
  r.post('/memories/:id/hide', wrap(async (req, res) => res.json(await hideMemory(req.params.id))));
  r.post('/memories/:id/restore', wrap(async (req, res) => res.json(await restoreMemory(req.params.id))));
  r.delete('/memories/:id', wrap(async (req, res) => {
    await deleteMemory(req.params.id);
    res.json({ ok: true });
  }));
  r.post('/memories/:id/accept-wording', wrap(async (req, res) => res.json(await acceptProposedWording(req.params.id))));
  r.post('/memories/:id/decline-wording', wrap(async (req, res) => {
    await declineProposedWording(req.params.id);
    res.json({ ok: true });
  }));
  r.get('/memories/:id/revisions', wrap(async (req, res) => res.json(await getRevisions(req.params.id))));

  // Conflicts
  r.get('/beings/:beingId/conflicts', wrap(async (req, res) => res.json(await listConflicts(req.params.beingId))));
  r.post('/conflicts/:id/resolve', wrap(async (req, res) => {
    await resolveConflict(req.params.id, req.body.keep);
    res.json({ ok: true });
  }));

  // Manual triggers (handy during the pilot)
  r.post('/beings/:beingId/capture-now', wrap(async (req, res) => res.json({ created: await captureBeing(req.params.beingId) })));
  r.post('/beings/:beingId/nightly-now', wrap(async (req, res) => res.json(await runNightlyForBeing(req.params.beingId))));

  return r;
}
