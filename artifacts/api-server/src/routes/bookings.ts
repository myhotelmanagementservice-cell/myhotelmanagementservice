import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, bookingsTable, roomsTable, guestsTable } from "@workspace/db";
import {
  ListBookingsQueryParams,
  CreateBookingBody,
  GetBookingParams,
  UpdateBookingParams,
  UpdateBookingBody,
  DeleteBookingParams,
  CheckInBookingParams,
  CheckOutBookingParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function formatBooking(b: typeof bookingsTable.$inferSelect, guest?: typeof guestsTable.$inferSelect | null, room?: typeof roomsTable.$inferSelect | null) {
  return {
    ...b,
    totalAmount: Number(b.totalAmount),
    createdAt: b.createdAt.toISOString(),
    guestName: guest ? `${guest.firstName} ${guest.lastName}` : null,
    roomNumber: room ? room.number : null,
    roomType: room ? room.type : null,
  };
}

async function getBookingWithDetails(id: number) {
  const result = await db
    .select()
    .from(bookingsTable)
    .leftJoin(guestsTable, eq(bookingsTable.guestId, guestsTable.id))
    .leftJoin(roomsTable, eq(bookingsTable.roomId, roomsTable.id))
    .where(eq(bookingsTable.id, id));
  if (!result[0]) return null;
  const { bookings, guests, rooms } = result[0];
  return formatBooking(bookings, guests, rooms);
}

router.get("/bookings", async (req, res): Promise<void> => {
  const query = ListBookingsQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success) {
    if (query.data.status) conditions.push(eq(bookingsTable.status, query.data.status));
    if (query.data.guestId) conditions.push(eq(bookingsTable.guestId, query.data.guestId));
  }

  const results = await db
    .select()
    .from(bookingsTable)
    .leftJoin(guestsTable, eq(bookingsTable.guestId, guestsTable.id))
    .leftJoin(roomsTable, eq(bookingsTable.roomId, roomsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(bookingsTable.createdAt);

  res.json(
    results.map(({ bookings, guests, rooms }) => formatBooking(bookings, guests, rooms))
  );
});

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      guestId: parsed.data.guestId,
      roomId: parsed.data.roomId,
      checkInDate: parsed.data.checkInDate,
      checkOutDate: parsed.data.checkOutDate,
      status: "confirmed",
      totalAmount: String(parsed.data.totalAmount),
      notes: parsed.data.notes ?? null,
    })
    .returning();

  await db.update(roomsTable).set({ status: "reserved" }).where(eq(roomsTable.id, parsed.data.roomId));

  const full = await getBookingWithDetails(booking.id);
  res.status(201).json(full);
});

router.get("/bookings/:id", async (req, res): Promise<void> => {
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const full = await getBookingWithDetails(params.data.id);
  if (!full) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(full);
});

router.patch("/bookings/:id", async (req, res): Promise<void> => {
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.guestId !== undefined) updateData.guestId = parsed.data.guestId;
  if (parsed.data.roomId !== undefined) updateData.roomId = parsed.data.roomId;
  if (parsed.data.checkInDate !== undefined) updateData.checkInDate = parsed.data.checkInDate;
  if (parsed.data.checkOutDate !== undefined) updateData.checkOutDate = parsed.data.checkOutDate;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.totalAmount !== undefined) updateData.totalAmount = String(parsed.data.totalAmount);
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [updated] = await db.update(bookingsTable).set(updateData).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const full = await getBookingWithDetails(updated.id);
  res.json(full);
});

router.delete("/bookings/:id", async (req, res): Promise<void> => {
  const params = DeleteBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [booking] = await db.delete(bookingsTable).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/bookings/:id/checkin", async (req, res): Promise<void> => {
  const params = CheckInBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [booking] = await db
    .update(bookingsTable)
    .set({ status: "checked_in" })
    .where(eq(bookingsTable.id, params.data.id))
    .returning();
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  await db.update(roomsTable).set({ status: "occupied" }).where(eq(roomsTable.id, booking.roomId));
  const full = await getBookingWithDetails(booking.id);
  res.json(full);
});

router.patch("/bookings/:id/checkout", async (req, res): Promise<void> => {
  const params = CheckOutBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [booking] = await db
    .update(bookingsTable)
    .set({ status: "checked_out" })
    .where(eq(bookingsTable.id, params.data.id))
    .returning();
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  await db.update(roomsTable).set({ status: "available" }).where(eq(roomsTable.id, booking.roomId));
  const full = await getBookingWithDetails(booking.id);
  res.json(full);
});

export default router;
