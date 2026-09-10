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

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "should", "could", "might",
  "must", "ma", "so", "than", "too", "very", "just", "now", "here", "there", "what",
  "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "can", "will", "just", "don", "should", "now"
]);

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

export async function retrieveDocumentChunks(userId: number, query: string, documentId?: number) {
  const terms = tokenize(query);
  const documents = await db.select({
    document: documentsTable,
    chunk: documentChunksTable,
  }).from(documentChunksTable)
    .innerJoin(documentsTable, eq(documentChunksTable.documentId, documentsTable.id))
    .where(and(eq(documentsTable.userId, userId), documentId ? eq(documentsTable.id, documentId) : undefined))
    .orderBy(desc(documentChunksTable.createdAt));
  return documents
    .map(({ document, chunk }) => {
      const chunkNormalized = normalizeText(chunk.content);
      const matchingTerms = terms.filter((term) => chunkNormalized.includes(term));
      return {
        document,
        chunk,
        score: matchingTerms.length,
        matchingTerms,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.content.length - a.chunk.content.length)
    .slice(0, 5);
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  plan: ["plan", "today", "tomorrow", "schedule", "agenda", "day", "focus", "prioritize", "next step", "this week", "organize", "what should i", "what to do"],
  goals: ["goal", "goals", "milestone", "progress", "objective", "target", "project", "building", "working on", "okr", "streak", "momentum", "complete"],
  memory: ["remember", "memory", "memories", "what do i", "who am i", "my name", "preference", "favorite", "what am i", "personally", "profile"],
  meetings: ["meeting", "meetings", "call", "calls", "appointment", "calendar", "schedule a meeting"],
  reminders: ["reminder", "reminders", "remind", "to do", "todo", "task", "check off", "don't forget", "due", "overdue"],
  documents: ["document", "documents", "file", "files", "upload", "pdf", "notes", "excerpt", "chunk", "indexed", "what does", "what did", "read"],
};

function classifyQuery(query: string): Set<string> {
  const q = query.toLowerCase();
  const selected = new Set<string>();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (q.includes(kw)) {
        selected.add(category);
        break;
      }
    }
  }
  return selected;
}

export async function buildContext(userId: number, query: string) {
  const categories = classifyQuery(query);
  const results = { memories: [] as any[], goals: [] as any[], reminders: [] as any[], meetings: [] as any[], chunks: [] as any[] };
  const fetches: Promise<void>[] = [];
  if (categories.has("memory")) {
    fetches.push(db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId)).orderBy(desc(memoriesTable.importance), desc(memoriesTable.updatedAt)).limit(5).then((r) => { results.memories = r; }));
  }
  if (categories.has("goals") || categories.has("plan")) {
    fetches.push(db.select().from(goalsTable).where(and(eq(goalsTable.userId, userId), eq(goalsTable.status, "active"))).orderBy(desc(goalsTable.priority), desc(goalsTable.updatedAt)).limit(5).then((r) => { results.goals = r; }));
  }
  if (categories.has("reminders") || categories.has("plan")) {
    fetches.push(db.select().from(remindersTable).where(and(eq(remindersTable.userId, userId), eq(remindersTable.status, "open"))).orderBy(remindersTable.dueAt).limit(5).then((r) => { results.reminders = r; }));
  }
  if (categories.has("meetings") || categories.has("plan")) {
    fetches.push(db.select().from(meetingsTable).where(eq(meetingsTable.userId, userId)).orderBy(desc(meetingsTable.createdAt)).limit(3).then((r) => { results.meetings = r; }));
  }
  if (categories.has("documents")) {
    fetches.push(retrieveDocumentChunks(userId, query).then((r) => { results.chunks = r; }));
  }
  await Promise.all(fetches);
  return results;
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