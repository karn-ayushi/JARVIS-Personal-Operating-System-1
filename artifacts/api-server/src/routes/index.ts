import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import jarvisRouter from "./jarvis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(jarvisRouter);

export default router;
