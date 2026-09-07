import { Router, type IRouter } from "express";
import { LoginBody, RegisterBody } from "@workspace/api-zod";
import {
  authenticateUser,
  clearSession,
  createSession,
  currentUser,
  findUserFromRequest,
  publicUser,
  registerUser,
  setSessionCookie,
} from "../lib/auth";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const user = await registerUser(parsed.data.name, parsed.data.email, parsed.data.password);
    setSessionCookie(res, await createSession(user.id));
    res.status(201).json(publicUser(user));
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_EXISTS") {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    throw error;
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await authenticateUser(parsed.data.email, parsed.data.password);
  if (!user) {
    res.status(401).json({ error: "Email or password is incorrect" });
    return;
  }
  setSessionCookie(res, await createSession(user.id));
  res.json(publicUser(user));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await clearSession(req, res);
  res.sendStatus(204);
});

router.get("/auth/me", requireUser, (req, res): void => {
  res.json(publicUser(currentUser(res)));
});

export default router;