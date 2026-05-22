import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";
import { guestsTable } from "./guests";

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  guestId: integer("guest_id").notNull().references(() => guestsTable.id),
  roomId: integer("room_id").notNull().references(() => roomsTable.id),
  checkInDate: text("check_in_date").notNull(),
  checkOutDate: text("check_out_date").notNull(),
  status: text("status").notNull().default("confirmed"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
