import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roomsTable = pgTable("rooms", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  type: text("type").notNull().default("single"),
  status: text("status").notNull().default("available"),
  pricePerNight: numeric("price_per_night", { precision: 10, scale: 2 }).notNull(),
  floor: integer("floor").notNull(),
  capacity: integer("capacity").notNull().default(2),
  description: text("description"),
  amenities: text("amenities"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRoomSchema = createInsertSchema(roomsTable).omit({ id: true, createdAt: true });
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof roomsTable.$inferSelect;
