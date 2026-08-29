import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  AccountIdSchema,
  DraftIdSchema,
  ThreadIdSchema,
  emptyStore,
  type Draft,
} from "../src/model";
import {
  clearCookie,
  createSession,
  deleteSession,
  getCookie,
  getSessionUser,
  setHttpOnlyCookie,
} from "./auth";
import { config } from "./config";
import { randomToken, signState, verifyState } from "./crypto";
import { migrateDatabase } from "./db";
import {
  GOOGLE_SCOPES,
  backfillGmailAccount,
  GmailSendFailure,
  connectGoogleAccount,
  createGoogleOAuthClient,
  mutateGmailThread,
  refreshGmailThread,
  sendGmailDraft,
  revokeGmailAccount,
  syncGmailAccount,
} from "./gmail";
import {
  claimDraftForSend,
  deleteDraft,
  disconnectAccount,
  loadMailStore,
  saveDraft,
  releaseDraftSend,
  setDefaultAccount,
} from "./store";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

const OAuthStateSchema = z.object({
  nonce: z.string().min(20),
  expiresAt: z.number().int(),
});

const DraftRequestSchema = z.object({
  id: DraftIdSchema,
  accountId: AccountIdSchema,
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new") }),
    z.object({ kind: z.literal("reply"), sourceThreadId: ThreadIdSchema }),
    z.object({ kind: z.literal("replyAll"), sourceThreadId: ThreadIdSchema }),
  ]),
  to: z.string(),
  cc: z.string(),
  subject: z.string(),
  body: z.string(),
  updatedAt: z.string().datetime(),
});

async function sessionUser(request: Request, response: Response) {
  const user = await getSessionUser(request);
  if (user === null) response.status(401).json({ error: "Connect Gmail first" });
  return user;
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});
app.get("/api/oauth/google/start", async (request, response) => {
  const configuredHost = new URL(config.APP_BASE_URL).host;
  if (request.get("host") !== configuredHost) {
    response.redirect(`${config.APP_BASE_URL}/api/oauth/google/start`);
    return;
  }
  const nonce = randomToken(24);
  const state = signState({ nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
  setHttpOnlyCookie(response, "post_oauth_nonce", nonce, 10 * 60);
  const oauth = createGoogleOAuthClient();
  response.redirect(oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  }));
});

app.get("/api/oauth/google/callback", async (request, response) => {
  const code = z.string().min(1).parse(request.query.code);
  const signedState = z.string().min(1).parse(request.query.state);
  const state = OAuthStateSchema.parse(verifyState(signedState));
  const cookieNonce = getCookie(request, "post_oauth_nonce");
  if (cookieNonce !== state.nonce || state.expiresAt < Date.now()) throw new Error("OAuth state expired");
  clearCookie(response, "post_oauth_nonce");

  const oauth = createGoogleOAuthClient();
  const tokenResult = await oauth.getToken(code);
  oauth.setCredentials(tokenResult.tokens);
  const idToken = tokenResult.tokens.id_token;
  if (idToken === null || idToken === undefined) throw new Error("Google did not return an identity token");
  const ticket = await oauth.verifyIdToken({ idToken, audience: config.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (
    payload?.sub === undefined ||
    payload.email === undefined ||
    payload.email_verified !== true
  ) {
    throw new Error("Google account identity is incomplete");
  }

  const currentUser = await getSessionUser(request);
  const connected = await connectGoogleAccount(
    currentUser?.id ?? null,
    {
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
      picture: payload.picture ?? null,
    },
    tokenResult.tokens,
  );
  await createSession(response, connected.userId);
  try {
    await syncGmailAccount(connected.userId, connected.accountId);
    void backfillGmailAccount(connected.userId, connected.accountId).catch((error) => {
      console.error("Gmail backfill failed", error);
    });
    response.redirect(`${config.APP_BASE_URL}/?gmail=connected`);
  } catch (error) {
    console.error("Initial Gmail sync failed", error);
    response.redirect(`${config.APP_BASE_URL}/?gmail=connected&sync=failed`);
  }
});

app.get("/api/store", async (request, response) => {
  const user = await getSessionUser(request);
  if (user === null) {
    response.json({ store: emptyStore, user: null });
    return;
  }
  const query = z.object({ threadId: ThreadIdSchema.optional() }).parse(request.query);
  response.json({ store: await loadMailStore(user.id, query.threadId ?? null), user });
});

app.post("/api/accounts/:accountId/sync", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const accountId = AccountIdSchema.parse(request.params.accountId);
  await syncGmailAccount(user.id, accountId);
  await backfillGmailAccount(user.id, accountId, 1);
  response.json({ store: await loadMailStore(user.id) });
});


app.delete("/api/accounts/:accountId", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const accountId = AccountIdSchema.parse(request.params.accountId);
  await revokeGmailAccount(user.id, accountId);
  await disconnectAccount(user.id, accountId);
  response.json({ store: await loadMailStore(user.id) });
});

app.patch("/api/preferences", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const body = z.object({ defaultAccountId: AccountIdSchema }).parse(request.body);
  await setDefaultAccount(user.id, body.defaultAccountId);
  response.json({ store: await loadMailStore(user.id) });
});

app.put("/api/drafts/:draftId", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const draft = DraftRequestSchema.parse({ ...request.body, id: request.params.draftId });
  await saveDraft(user.id, draft);
  response.status(204).end();
});

app.delete("/api/drafts/:draftId", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const draftId = DraftIdSchema.parse(request.params.draftId);
  await deleteDraft(user.id, draftId);
  response.status(204).end();
});

app.post("/api/threads/:threadId/sync", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const threadId = ThreadIdSchema.parse(request.params.threadId);
  await refreshGmailThread(user.id, threadId);
  response.json({ store: await loadMailStore(user.id, threadId) });
});

const MutationSchema = z.enum(["archive", "inbox", "trash", "read", "unread", "star", "unstar"]);
app.post("/api/threads/:threadId/:mutation", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const threadId = ThreadIdSchema.parse(request.params.threadId);
  const mutation = MutationSchema.parse(request.params.mutation);
  await mutateGmailThread(user.id, threadId, mutation);
  response.json({ store: await loadMailStore(user.id, threadId) });
});

app.post("/api/send", async (request, response) => {
  const user = await sessionUser(request, response);
  if (user === null) return;
  const draft: Draft = DraftRequestSchema.parse(request.body);
  if (!(await claimDraftForSend(user.id, draft.id))) {
    response.status(409).json({ error: "Draft is already sending or no longer exists" });
    return;
  }
  try {
    const threadId = await sendGmailDraft(user.id, draft);
    response.json({ store: await loadMailStore(user.id, threadId), threadId });
  } catch (error) {
    if (!(error instanceof GmailSendFailure) || error.safeToRetry) {
      await releaseDraftSend(user.id, draft.id);
    }
    throw error;
  }
});

app.post("/api/logout", async (request, response) => {
  await deleteSession(request);
  clearCookie(response, "post_session");
  response.status(204).end();
});

app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  response.status(500).json({ error: message });
});

await migrateDatabase();
app.listen(config.API_PORT, "127.0.0.1", () => {
  console.log(`Gmail API server ready at http://127.0.0.1:${config.API_PORT}`);
});
