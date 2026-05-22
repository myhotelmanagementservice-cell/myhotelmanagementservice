import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import guestsRouter from "./guests";
import bookingsRouter from "./bookings";
import dashboardRouter from "./dashboard";
import crownPlazaRouter from "./crown-plaza";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomsRouter);
router.use(guestsRouter);
router.use(bookingsRouter);
router.use(dashboardRouter);
router.use(crownPlazaRouter);

export default router;
