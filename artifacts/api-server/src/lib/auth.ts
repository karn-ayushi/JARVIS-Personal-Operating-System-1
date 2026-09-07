import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";

const COOKIE_NAME = "jarvis_session";
const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function registerUser(name: string, email: string, password: string): Promise<User> {
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing[0]) throw new Error("EMAIL_EXISTS");
  const [user] = await db.insert(usersTable).values({
    name: name.trim(),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
  }).returning();
  return user;
}

export async function authenticateUser(email: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessionsTable).values({ userId, tokenHash: hashToken(token), expiresAt });
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export async function clearSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (token) await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashToken(token)));
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export async function findUserFromRequest(req: Request): Promise<User | null> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) return null;
  const [session] = await db.select().from(sessionsTable).where(
    and(eq(sessionsTable.tokenHash, hashToken(token)), gt(sessionsTable.expiresAt, new Date())),
  ).limit(1);
  if (!session) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
  return user ?? null;
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await findUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.user = user;
  next();
}

export function currentUser(res: Response): User {
  return res.locals.user as User;
}

export function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email };
}