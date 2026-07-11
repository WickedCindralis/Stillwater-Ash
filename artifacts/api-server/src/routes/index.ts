import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ashRouter from "./ash";

const router: IRouter = Router();

// healthRouter is mounted first and owns `GET /api` (bare base path) + `/healthz`.
// Do not add a `GET /` to ashRouter — it would be shadowed by the health route.
router.use(healthRouter);
router.use(ashRouter);

export default router;
