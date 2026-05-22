import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, guestsTable } from "@workspace/db";
import {
  ListGuestsQueryParams,
  CreateGuestBody,
  GetGuestParams,
  UpdateGuestParams,
  UpdateGuestBody,
  DeleteGuestParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/guests", async (req, res): Promise<void> => {
  const query = ListGuestsQueryParams.safeParse(req.query);
  if (query.success && query.data.search) {
    const s = `%${query.data.search}%`;
    const guests = await db
      .select()
      .from(guestsTable)
      .where(
        or(
          ilike(guestsTable.firstName, s),
          ilike(guestsTable.lastName, s),
          ilike(guestsTable.email, s),
          ilike(guestsTable.phone, s)
        )
      )
      .orderBy(guestsTable.lastName);
    res.json(guests.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })));
    return;
  }
  const guests = await db.select().from(guestsTable).orderBy(guestsTable.lastName);
  res.json(guests.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })));
});

router.post("/guests", async (req, res): Promise<void> => {
  const parsed = CreateGuestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [guest] = await db
    .insert(guestsTable)
    .values({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      address: parsed.data.address ?? null,
      nationality: parsed.data.nationality ?? null,
      idType: parsed.data.idType ?? null,
      idNumber: parsed.data.idNumber ?? null,
    })
    .returning();
  res.status(201).json({ ...guest, createdAt: guest.createdAt.toISOString() });
});

router.get("/guests/:id", async (req, res): Promise<void> => {
  const params = GetGuestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [guest] = await db.select().from(guestsTable).where(eq(guestsTable.id, params.data.id));
  if (!guest) {
    res.status(404).json({ error: "Guest not found" });
    return;
  }
  res.json({ ...guest, createdAt: guest.createdAt.toISOString() });
});

router.patch("/guests/:id", async (req, res): Promise<void> => {
  const params = UpdateGuestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateGuestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [guest] = await db.update(guestsTable).set(parsed.data).where(eq(guestsTable.id, params.data.id)).returning();
  if (!guest) {
    res.status(404).json({ error: "Guest not found" });
    return;
  }
  res.json({ ...guest, createdAt: guest.createdAt.toISOString() });
});

router.delete("/guests/:id", async (req, res): Promise<void> => {
  const params = DeleteGuestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [guest] = await db.delete(guestsTable).where(eq(guestsTable.id, params.data.id)).returning();
  if (!guest) {
    res.status(404).json({ error: "Guest not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
