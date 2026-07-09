import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ashRouter from "./ash";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ashRouter);

export default router;
