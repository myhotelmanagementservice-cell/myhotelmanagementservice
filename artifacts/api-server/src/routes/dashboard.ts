import { Router, type IRouter } from "express";
import { eq, count, sql } from "drizzle-orm";
import { db, roomsTable, guestsTable, bookingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];

  const [roomStats] = await db
    .select({
      total: count(),
      available: sql<number>`count(*) filter (where ${roomsTable.status} = 'available')`,
      occupied: sql<number>`count(*) filter (where ${roomsTable.status} = 'occupied')`,
    })
    .from(roomsTable);

  const [guestStats] = await db.select({ total: count() }).from(guestsTable);
  const [bookingStats] = await db.select({ total: count() }).from(bookingsTable);

  const [checkIns] = await db
    .select({ count: count() })
    .from(bookingsTable)
    .where(eq(bookingsTable.checkInDate, today));

  const [checkOuts] = await db
    .select({ count: count() })
    .from(bookingsTable)
    .where(eq(bookingsTable.checkOutDate, today));

  const [todayRevenue] = await db
    .select({
      total: sql<number>`coalesce(sum(cast(${bookingsTable.totalAmount} as numeric)), 0)`,
    })
    .from(bookingsTable)
    .where(sql`date(${bookingsTable.createdAt}) = current_date`);

  const currentMonth = today.substring(0, 7);
  const [monthRevenue] = await db
    .select({
      total: sql<number>`coalesce(sum(cast(${bookingsTable.totalAmount} as numeric)), 0)`,
    })
    .from(bookingsTable)
    .where(sql`to_char(${bookingsTable.createdAt}, 'YYYY-MM') = ${currentMonth}`);

  res.json({
    totalRooms: Number(roomStats?.total ?? 0),
    availableRooms: Number(roomStats?.available ?? 0),
    occupiedRooms: Number(roomStats?.occupied ?? 0),
    totalGuests: Number(guestStats?.total ?? 0),
    totalBookings: Number(bookingStats?.total ?? 0),
    revenueToday: Number(todayRevenue?.total ?? 0),
    revenueThisMonth: Number(monthRevenue?.total ?? 0),
    checkInsToday: Number(checkIns?.count ?? 0),
    checkOutsToday: Number(checkOuts?.count ?? 0),
  });
});

router.get("/dashboard/recent-bookings", async (_req, res): Promise<void> => {
  const results = await db
    .select()
    .from(bookingsTable)
    .leftJoin(guestsTable, eq(bookingsTable.guestId, guestsTable.id))
    .leftJoin(roomsTable, eq(bookingsTable.roomId, roomsTable.id))
    .orderBy(sql`${bookingsTable.createdAt} desc`)
    .limit(10);

  res.json(
    results.map(({ bookings, guests, rooms }) => ({
      ...bookings,
      totalAmount: Number(bookings.totalAmount),
      createdAt: bookings.createdAt.toISOString(),
      guestName: guests ? `${guests.firstName} ${guests.lastName}` : null,
      roomNumber: rooms ? rooms.number : null,
      roomType: rooms ? rooms.type : null,
    }))
  );
});

router.get("/dashboard/room-status", async (_req, res): Promise<void> => {
  const [stats] = await db
    .select({
      available: sql<number>`count(*) filter (where ${roomsTable.status} = 'available')`,
      occupied: sql<number>`count(*) filter (where ${roomsTable.status} = 'occupied')`,
      maintenance: sql<number>`count(*) filter (where ${roomsTable.status} = 'maintenance')`,
      reserved: sql<number>`count(*) filter (where ${roomsTable.status} = 'reserved')`,
    })
    .from(roomsTable);

  res.json({
    available: Number(stats?.available ?? 0),
    occupied: Number(stats?.occupied ?? 0),
    maintenance: Number(stats?.maintenance ?? 0),
    reserved: Number(stats?.reserved ?? 0),
  });
});

export default router;
