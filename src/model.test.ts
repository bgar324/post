import { describe, expect, it } from "vitest";
import {
  AccountIdSchema,
  DraftIdSchema,
  MessageIdSchema,
  ThreadIdSchema,
  appReducer,
  createInitialState,
  validateDraftRecipients,
  type Route,
} from "./model";
import { searchThreads } from "./search";
import { testStore } from "./model.test.fixture";
import { selectCurrentThread, selectVisibleDrafts, selectVisibleThreads, selectViewCount, threadSender } from "./selectors";

const inboxRoute: Route = { kind: "mailbox", view: "inbox", selectedThreadId: null };

describe("account-safe compose routing", () => {
  it("derives reply ownership from the receiving thread", () => {
    const source = testStore.threads.find((thread) => thread.subject.includes("Paper revisions"));
    if (source === undefined) throw new Error("Missing seeded UCLA thread");

    const state = createInitialState(testStore, inboxRoute);
    const next = appReducer(state, {
      type: "composeFromThread",
      draftId: DraftIdSchema.parse("draft_test-reply"),
      threadId: source.id,
      mode: "reply",
      now: "2026-08-28T00:00:00.000Z",
    });

    expect(next.store.drafts[0]).toMatchObject({
      accountId: source.accountId,
      origin: { kind: "reply", sourceThreadId: source.id },
    });
  });

  it("detaches reply metadata before changing its sending identity", () => {
    const source = testStore.threads.find((thread) => thread.subject.includes("Interview scheduling"));
    const target = testStore.accounts.find((account) => account.badgeLabel === "Studio");
    if (source === undefined || target === undefined) throw new Error("Missing identity-switch fixtures");

    const draftId = DraftIdSchema.parse("draft_test-switch");
    const initial = createInitialState(testStore, inboxRoute);
    const replying = appReducer(initial, {
      type: "composeFromThread",
      draftId,
      threadId: source.id,
      mode: "reply",
      now: "2026-08-28T00:00:00.000Z",
    });
    const requested = appReducer(replying, {
      type: "draftRequestIdentity",
      draftId,
      targetAccountId: target.id,
    });
    const confirmed = appReducer(requested, { type: "draftConfirmIdentity" });
    const switched = confirmed.store.drafts.find((draft) => draft.id === draftId);

    expect(requested.composer.kind).toBe("confirmIdentity");
    expect(switched).toMatchObject({ accountId: target.id, origin: { kind: "new" } });
  });

  it("requires confirmation before moving a Cc-only draft between accounts", () => {
    const personal = testStore.accounts.find((account) => account.badgeLabel === "Personal");
    if (personal === undefined) throw new Error("Missing Personal account");

    const draftId = DraftIdSchema.parse("draft_test-cc-switch");
    const initial = createInitialState(testStore, inboxRoute);
    const composing = appReducer(initial, {
      type: "composeNew",
      draftId,
      now: "2026-08-28T00:00:00.000Z",
    });
    const withCc = appReducer(composing, {
      type: "draftPatch",
      draftId,
      patch: { cc: "theo@example.com" },
      now: "2026-08-28T00:01:00.000Z",
    });
    const requested = appReducer(withCc, {
      type: "draftRequestIdentity",
      draftId,
      targetAccountId: personal.id,
    });

    expect(requested.composer).toMatchObject({
      kind: "confirmIdentity",
      draftId,
      targetAccountId: personal.id,
    });
  });

  it("preserves original Cc placement in Reply all", () => {
    const source = testStore.threads.find((thread) => thread.subject.includes("Paper revisions"));
    if (source === undefined) throw new Error("Missing seeded Cc thread");

    const next = appReducer(createInitialState(testStore, inboxRoute), {
      type: "composeFromThread",
      draftId: DraftIdSchema.parse("draft_test-reply-all"),
      threadId: source.id,
      mode: "replyAll",
      now: "2026-08-28T00:00:00.000Z",
    });
    const draft = next.store.drafts[0];

    expect(draft?.to).toContain("echen@ucla.edu");
    expect(draft?.to).not.toContain("theomartin@ucla.edu");
    expect(draft?.cc).toContain("theomartin@ucla.edu");
  });

  it("uses recent, filtered, then default identity precedence for new compose", () => {
    const studio = testStore.accounts.find((account) => account.badgeLabel === "Studio");
    const ucla = testStore.accounts.find((account) => account.badgeLabel === "UCLA");
    if (studio === undefined || ucla === undefined) throw new Error("Missing compose identity fixtures");

    const recentState = {
      ...createInitialState(testStore, inboxRoute),
      accountFilter: ucla.id,
      sidebarOpen: true,
    };
    const recentDraft = appReducer(recentState, {
      type: "composeNew",
      draftId: DraftIdSchema.parse("draft_test-recent"),
      now: "2026-08-28T00:00:00.000Z",
    });
    expect(recentDraft.store.drafts[0]?.accountId).toBe(studio.id);
    expect(recentDraft.sidebarOpen).toBe(false);

    const filteredStore = {
      ...testStore,
      preferences: { ...testStore.preferences, lastComposeAccountId: null },
    };
    const filteredState = {
      ...createInitialState(filteredStore, inboxRoute),
      accountFilter: ucla.id,
    };
    const filteredDraft = appReducer(filteredState, {
      type: "composeNew",
      draftId: DraftIdSchema.parse("draft_test-filtered"),
      now: "2026-08-28T00:00:00.000Z",
    });
    expect(filteredDraft.store.drafts[0]?.accountId).toBe(ucla.id);
  });

  it("sends from the draft owner without accepting an account in the send action", () => {
    const source = testStore.threads.find((thread) => thread.subject.includes("Interview scheduling"));
    if (source === undefined) throw new Error("Missing personal thread");

    const draftId = DraftIdSchema.parse("draft_test-send");
    const initial = createInitialState(testStore, inboxRoute);
    const replying = appReducer(initial, {
      type: "composeFromThread",
      draftId,
      threadId: source.id,
      mode: "reply",
      now: "2026-08-28T00:00:00.000Z",
    });
    const sent = appReducer(replying, {
      type: "draftSend",
      draftId,
      threadId: ThreadIdSchema.parse("thread_test-sent"),
      messageId: MessageIdSchema.parse("msg_test-sent"),
      now: "2026-08-28T00:01:00.000Z",
    });
    const sentThread = sent.store.threads.find((thread) => thread.id === source.id);
    const sentMessage = sentThread?.messages.at(-1);
    const owner = testStore.accounts.find((account) => account.id === source.accountId);

    expect(sentThread?.messages).toHaveLength(source.messages.length + 1);
    expect(sentMessage?.id).toBe(MessageIdSchema.parse("msg_test-sent"));
    expect(sentMessage?.from.email).toBe(owner?.email);
    expect(sent.route).toMatchObject({ kind: "mailbox", view: "sent", selectedThreadId: source.id });
    expect(sent.store.threads.some((thread) => thread.id === ThreadIdSchema.parse("thread_test-sent"))).toBe(false);
    expect(sent.store.drafts.some((draft) => draft.id === draftId)).toBe(false);
    expect(sent.toast).toEqual({ kind: "success", message: "Added to local Sent" });
  });
});

describe("recipient and mailbox boundaries", () => {
  it("rejects any invalid token instead of silently dropping it", () => {
    const validation = validateDraftRecipients({
      to: "valid@example.com, broken",
      cc: "",
    });

    expect(validation).toEqual({ kind: "invalid", values: ["broken"] });
  });

  it("allows a valid Cc-only message and records its recipient", () => {
    const draftId = DraftIdSchema.parse("draft_test-cc-only");
    const threadId = ThreadIdSchema.parse("thread_test-cc-only");
    const initial = createInitialState(testStore, inboxRoute);
    const composing = appReducer(initial, {
      type: "composeNew",
      draftId,
      now: "2026-08-28T00:00:00.000Z",
    });
    const withCc = appReducer(composing, {
      type: "draftPatch",
      draftId,
      patch: { cc: "Theo <theo@example.com>", subject: "Cc only" },
      now: "2026-08-28T00:01:00.000Z",
    });
    const sent = appReducer(withCc, {
      type: "draftSend",
      draftId,
      threadId,
      messageId: MessageIdSchema.parse("msg_test-cc-only"),
      now: "2026-08-28T00:02:00.000Z",
    });
    const sentThread = sent.store.threads.find((thread) => thread.id === threadId);
    if (sentThread === undefined) throw new Error("Cc-only sent thread missing");
    const message = sentThread?.messages[0];
    const replying = appReducer(sent, {
      type: "composeFromThread",
      draftId: DraftIdSchema.parse("draft_test-cc-only-reply"),
      threadId,
      mode: "reply",
      now: "2026-08-28T00:03:00.000Z",
    });
    const replyDraft = replying.store.drafts[0];

    expect(message?.to).toEqual([]);
    expect(message?.cc).toEqual([{ name: "Theo", email: "theo@example.com" }]);
    expect(threadSender(sentThread)).toBe("Cc: Theo");
    expect(replyDraft?.to).toBe("Theo <theo@example.com>");
  });

  it("removes trashed outgoing conversations from Sent results and counts", () => {
    const sentRoute: Route = { kind: "mailbox", view: "sent", selectedThreadId: null };
    const initial = createInitialState(testStore, sentRoute);
    const source = testStore.threads.find((thread) => thread.subject.includes("Intro to Oliver"));
    if (source === undefined) throw new Error("Missing seeded Sent thread");
    const beforeCount = selectViewCount(initial, "sent");

    const trashed = appReducer(initial, {
      type: "threadMove",
      threadId: source.id,
      mailbox: "trash",
    });

    expect(selectVisibleThreads(trashed).threads.some((thread) => thread.id === source.id)).toBe(false);
    expect(selectViewCount(trashed, "sent")).toBe(beforeCount - 1);
  });

  it("does not create reply drafts from trashed conversations", () => {
    const source = testStore.threads.find((thread) => thread.mailbox === "trash");
    if (source === undefined) throw new Error("Missing seeded Trash thread");
    const initial = createInitialState(testStore, {
      kind: "mailbox",
      view: "trash",
      selectedThreadId: source.id,
    });

    const next = appReducer(initial, {
      type: "composeFromThread",
      draftId: DraftIdSchema.parse("draft_test-trash-reply"),
      threadId: source.id,
      mode: "reply",
      now: "2026-08-28T00:00:00.000Z",
    });

    expect(next.store.drafts).toEqual(initial.store.drafts);
    expect(next.composer).toEqual({ kind: "closed" });
  });

  it("sends a saved reply as a new thread when its source was trashed", () => {
    const source = testStore.threads.find((thread) => thread.subject.includes("Interview scheduling"));
    if (source === undefined) throw new Error("Missing seeded reply source");
    const draftId = DraftIdSchema.parse("draft_test-detached-trash");
    const threadId = ThreadIdSchema.parse("thread_test-detached-trash");
    const initial = createInitialState(testStore, inboxRoute);
    const replying = appReducer(initial, {
      type: "composeFromThread",
      draftId,
      threadId: source.id,
      mode: "reply",
      now: "2026-08-28T00:00:00.000Z",
    });
    const trashed = appReducer(replying, {
      type: "threadMove",
      threadId: source.id,
      mailbox: "trash",
    });
    const sent = appReducer(trashed, {
      type: "draftSend",
      draftId,
      threadId,
      messageId: MessageIdSchema.parse("msg_test-detached-trash"),
      now: "2026-08-28T00:01:00.000Z",
    });
    const original = sent.store.threads.find((thread) => thread.id === source.id);
    const detached = sent.store.threads.find((thread) => thread.id === threadId);

    expect(original?.mailbox).toBe("trash");
    expect(original?.messages).toHaveLength(source.messages.length);
    expect(detached).toMatchObject({ id: threadId, mailbox: "sent", accountId: source.accountId });
    expect(sent.route).toMatchObject({ kind: "mailbox", view: "sent", selectedThreadId: threadId });
  });

  it("excludes disabled accounts from global views and counts", () => {
    const studio = testStore.accounts.find((account) => account.badgeLabel === "Studio");
    if (studio === undefined) throw new Error("Missing Studio account");
    const studioThread = testStore.threads.find((thread) => thread.accountId === studio.id);
    if (studioThread === undefined) throw new Error("Missing Studio thread");
    const initial = createInitialState(testStore, inboxRoute);
    const disabled = appReducer(initial, {
      type: "accountEnabled",
      accountId: studio.id,
      enabled: false,
    });
    const selectedDisabled = {
      ...disabled,
      route: { kind: "mailbox", view: "inbox", selectedThreadId: studioThread.id } satisfies Route,
    };

    expect(selectVisibleThreads(disabled).threads.every((thread) => thread.accountId !== studio.id)).toBe(true);
    expect(selectVisibleDrafts(disabled)).toEqual([]);
    expect(selectViewCount(disabled, "drafts")).toBe(0);
    expect(selectViewCount(disabled, "sent")).toBeLessThan(selectViewCount(initial, "sent"));
    expect(selectCurrentThread(selectedDisabled)).toBeUndefined();
  });
});

describe("global structured search", () => {
  it("combines account, unread, and attachment predicates", () => {
    const result = searchThreads(
      testStore.threads,
      testStore.accounts,
      "account:UCLA is:unread has:attachment",
    );

    expect(result.parsed.errors).toEqual([]);
    expect(result.threads.map((thread) => thread.subject)).toEqual(["Paper revisions — Section 4"]);
  });

  it("keeps quoted natural text as one predicate", () => {
    const result = searchThreads(testStore.threads, testStore.accounts, '"field notes"');

    expect(result.parsed.predicates).toEqual([{ kind: "text", value: "field notes" }]);
    expect(result.threads.some((thread) => thread.subject === "Transit study: field notes batch 06")).toBe(true);
  });

  it("accepts validated account IDs only at typed boundaries", () => {
    expect(AccountIdSchema.safeParse("thread_personal").success).toBe(false);
    expect(AccountIdSchema.safeParse("acct_personal").success).toBe(true);
  });
});
