import { and, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";
import {
  activityEventsTable,
  documentChunksTable,
  documentsTable,
  goalsTable,
  memoriesTable,
  meetingsTable,
  milestonesTable,
  remindersTable,
  xpEventsTable,
} from "@workspace/db";
import { db } from "@workspace/db";

export async function logActivity(userId: number, kind: string, title: string, description = "") {
  await db.insert(activityEventsTable).values({ userId, kind, title, description });
}

export async function awardXp(userId: number, eventKey: string, amount: number) {
  const existing = await db.select().from(xpEventsTable).where(
    and(eq(xpEventsTable.userId, userId), eq(xpEventsTable.eventKey, eventKey)),
  ).limit(1);
  if (!existing[0]) await db.insert(xpEventsTable).values({ userId, eventKey, amount });
}

export function levelForXp(xp: number): number {
  if (xp >= 450) return 4;
  if (xp >= 250) return 3;
  if (xp >= 100) return 2;
  return 1;
}

export function nextLevelXp(level: number): number {
  return [0, 100, 250, 450, 700][level] ?? 700;
}

export function splitIntoChunks(text: string, size = 1100): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += size) chunks.push(clean.slice(i, i + size));
  return chunks;
}

export async function retrieveDocumentChunks(userId: number, query: string, documentId?: number) {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const documents = await db.select({
    document: documentsTable,
    chunk: documentChunksTable,
  }).from(documentChunksTable)
    .innerJoin(documentsTable, eq(documentChunksTable.documentId, documentsTable.id))
    .where(and(eq(documentsTable.userId, userId), documentId ? eq(documentsTable.id, documentId) : undefined))
    .orderBy(desc(documentChunksTable.createdAt));
  return documents
    .map(({ document, chunk }) => ({
      document,
      chunk,
      score: terms.reduce((score, term) => score + (chunk.content.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function buildContext(userId: number, query: string) {
  const [memories, goals, reminders, meetings] = await Promise.all([
    db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId)).orderBy(desc(memoriesTable.importance), desc(memoriesTable.updatedAt)).limit(6),
    db.select().from(goalsTable).where(and(eq(goalsTable.userId, userId), eq(goalsTable.status, "active"))).orderBy(desc(goalsTable.priority), desc(goalsTable.updatedAt)).limit(6),
    db.select().from(remindersTable).where(and(eq(remindersTable.userId, userId), eq(remindersTable.status, "open"))).orderBy(remindersTable.dueAt).limit(6),
    db.select().from(meetingsTable).where(eq(meetingsTable.userId, userId)).orderBy(desc(meetingsTable.createdAt)).limit(4),
  ]);
  const chunks = await retrieveDocumentChunks(userId, query);
  return { memories, goals, reminders, meetings, chunks };
}

export async function searchKnowledge(userId: number, query: string) {
  const pattern = `%${query}%`;
  const [memories, goals, documents, meetings, reminders] = await Promise.all([
    db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), ilike(memoriesTable.content, pattern))).limit(10),
    db.select().from(goalsTable).where(and(eq(goalsTable.userId, userId), or(ilike(goalsTable.title, pattern), ilike(goalsTable.description, pattern)))).limit(10),
    db.select().from(documentsTable).where(and(eq(documentsTable.userId, userId), or(ilike(documentsTable.title, pattern), ilike(documentsTable.contentText, pattern)))).limit(10),
    db.select().from(meetingsTable).where(and(eq(meetingsTable.userId, userId), or(ilike(meetingsTable.title, pattern), ilike(meetingsTable.summary, pattern)))).limit(10),
    db.select().from(remindersTable).where(and(eq(remindersTable.userId, userId), or(ilike(remindersTable.title, pattern), ilike(remindersTable.description, pattern)))).limit(10),
  ]);
  return [
    ...memories.map((item) => ({ kind: "memory", title: "Memory", excerpt: item.content, occurredAt: item.updatedAt })),
    ...goals.map((item) => ({ kind: "goal", title: item.title, excerpt: item.description || `${item.progress}% complete`, occurredAt: item.updatedAt })),
    ...documents.map((item) => ({ kind: "document", title: item.title, excerpt: item.contentText.slice(0, 220), occurredAt: item.createdAt })),
    ...meetings.map((item) => ({ kind: "meeting", title: item.title, excerpt: item.summary, occurredAt: item.createdAt })),
    ...reminders.map((item) => ({ kind: "reminder", title: item.title, excerpt: item.description, occurredAt: item.dueAt })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 20);
}