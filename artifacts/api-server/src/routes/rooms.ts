import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, roomsTable } from "@workspace/db";
import {
  ListRoomsQueryParams,
  CreateRoomBody,
  GetRoomParams,
  UpdateRoomParams,
  UpdateRoomBody,
  DeleteRoomParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/rooms", async (req, res): Promise<void> => {
  const query = ListRoomsQueryParams.safeParse(req.query);
  let rooms = await db.select().from(roomsTable).orderBy(roomsTable.number);
  if (query.success) {
    if (query.data.status) {
      rooms = rooms.filter((r) => r.status === query.data.status);
    }
    if (query.data.type) {
      rooms = rooms.filter((r) => r.type === query.data.type);
    }
  }
  res.json(
    rooms.map((r) => ({
      ...r,
      pricePerNight: Number(r.pricePerNight),
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db
    .insert(roomsTable)
    .values({
      number: parsed.data.number,
      type: parsed.data.type ?? "single",
      status: parsed.data.status ?? "available",
      pricePerNight: String(parsed.data.pricePerNight),
      floor: parsed.data.floor,
      capacity: parsed.data.capacity,
      description: parsed.data.description ?? null,
      amenities: parsed.data.amenities ?? null,
    })
    .returning();
  res.status(201).json({ ...room, pricePerNight: Number(room.pricePerNight), createdAt: room.createdAt.toISOString() });
});

router.get("/rooms/:id", async (req, res): Promise<void> => {
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({ ...room, pricePerNight: Number(room.pricePerNight), createdAt: room.createdAt.toISOString() });
});

router.patch("/rooms/:id", async (req, res): Promise<void> => {
  const params = UpdateRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.number !== undefined) updateData.number = parsed.data.number;
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.pricePerNight !== undefined) updateData.pricePerNight = String(parsed.data.pricePerNight);
  if (parsed.data.floor !== undefined) updateData.floor = parsed.data.floor;
  if (parsed.data.capacity !== undefined) updateData.capacity = parsed.data.capacity;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.amenities !== undefined) updateData.amenities = parsed.data.amenities;

  const [room] = await db.update(roomsTable).set(updateData).where(eq(roomsTable.id, params.data.id)).returning();
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({ ...room, pricePerNight: Number(room.pricePerNight), createdAt: room.createdAt.toISOString() });
});

router.delete("/rooms/:id", async (req, res): Promise<void> => {
  const params = DeleteRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [room] = await db.delete(roomsTable).where(eq(roomsTable.id, params.data.id)).returning();
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
