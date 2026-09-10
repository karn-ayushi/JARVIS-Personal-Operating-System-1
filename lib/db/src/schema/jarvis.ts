import { createInsertSchema } from "drizzle-zod";
import {
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const usersTable = pgTable("jarvis_users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamps.createdAt,
});

export const sessionsTable = pgTable("jarvis_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamps.createdAt,
});

export const memoriesTable = pgTable("jarvis_memories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  category: varchar("category", { length: 50 }).notNull().default("personal"),
  importance: integer("importance").notNull().default(1),
  source: varchar("source", { length: 50 }).notNull().default("manual"),
  ...timestamps,
});

export const documentsTable = pgTable("jarvis_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  fileSize: integer("file_size").notNull().default(0),
  processingStatus: varchar("processing_status", { length: 32 }).notNull().default("ready"),
  contentText: text("content_text").notNull(),
  objectPath: text("object_path"),
  chunkCount: integer("chunk_count").notNull().default(0),
  ...timestamps,
});

export const documentChunksTable = pgTable("jarvis_document_chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  createdAt: timestamps.createdAt,
});

export const goalsTable = pgTable("jarvis_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  category: varchar("category", { length: 80 }).notNull().default("personal"),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  progress: integer("progress").notNull().default(0),
  deadline: date("deadline", { mode: "string" }),
  ...timestamps,
});

export const milestonesTable = pgTable("jarvis_milestones", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  progress: integer("progress").notNull().default(0),
  dueDate: date("due_date", { mode: "string" }),
  ...timestamps,
});

export const conversationsTable = pgTable("jarvis_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull().default("New conversation"),
  ...timestamps,
});

export const chatMessagesTable = pgTable("jarvis_chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources").$type<Array<{ type: string; title: string; excerpt: string }>>().notNull().default([]),
  createdAt: timestamps.createdAt,
});

export const meetingsTable = pgTable("jarvis_meetings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  transcript: text("transcript").notNull(),
  summary: text("summary").notNull().default(""),
  decisions: jsonb("decisions").$type<string[]>().notNull().default([]),
  actionItems: jsonb("action_items").$type<string[]>().notNull().default([]),
  participants: jsonb("participants").$type<string[]>().notNull().default([]),
  meetingDate: date("meeting_date", { mode: "string" }),
  ...timestamps,
});

export const remindersTable = pgTable("jarvis_reminders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  source: varchar("source", { length: 40 }).notNull().default("manual"),
});

export const activityEventsTable = pgTable("jarvis_activity_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  kind: varchar("kind", { length: 40 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const xpEventsTable = pgTable("jarvis_xp_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  eventKey: varchar("event_key", { length: 255 }).notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamps.createdAt,
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true });
export const insertMemorySchema = createInsertSchema(memoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentChunkSchema = createInsertSchema(documentChunksTable).omit({ id: true, createdAt: true });
export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMilestoneSchema = createInsertSchema(milestonesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertConversationSchema = createInsertSchema(conversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export const insertMeetingSchema = createInsertSchema(meetingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReminderSchema = createInsertSchema(remindersTable).omit({ id: true });
export const insertActivityEventSchema = createInsertSchema(activityEventsTable).omit({ id: true, occurredAt: true });
export const insertXpEventSchema = createInsertSchema(xpEventsTable).omit({ id: true, createdAt: true });

export type User = typeof usersTable.$inferSelect;
export type Session = typeof sessionsTable.$inferSelect;
export type Memory = typeof memoriesTable.$inferSelect;
export type Document = typeof documentsTable.$inferSelect;
export type DocumentChunk = typeof documentChunksTable.$inferSelect;
export type Goal = typeof goalsTable.$inferSelect;
export type Milestone = typeof milestonesTable.$inferSelect;
export type Conversation = typeof conversationsTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type Meeting = typeof meetingsTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type ActivityEvent = typeof activityEventsTable.$inferSelect;
export type XpEvent = typeof xpEventsTable.$inferSelect;

export type JsonStringList = z.infer<z.ZodArray<z.ZodString>>;