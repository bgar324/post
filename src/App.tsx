import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import {
  deleteRemoteDraft,
  disconnectRemoteAccount,
  fetchBootstrap,
  mutateRemoteThread,
  refreshRemoteThread,
  saveRemoteDraft,
  sendRemoteDraft,
  setRemoteDefaultAccount,
  syncAccount,
  type AppUser,
  type BootstrapResult,
  type ThreadMutation,
} from "./api";
import { Composer } from "./components/Composer";
import { SettingsView } from "./components/SettingsView";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { Sidebar } from "./components/Sidebar";
import { ThreadList } from "./components/ThreadList";
import { ThreadReader } from "./components/ThreadReader";
import { Toast } from "./components/Toast";
import {
  appReducer,
  createDraftId,
  createInitialState,
  emptyStore,
  getAccount,
  routeFromHash,
  routeToHash,
  validateDraftRecipients,
  type Account,
  type AccountId,
  type Draft,
  type DraftPatch,
  type MailStore,
  type MailboxView,
  type Route,
  type ThreadId,
} from "./model";
import {
  selectAccountForThread,
  selectCurrentDraft,
  selectCurrentThread,
  selectVisibleDrafts,
  selectVisibleThreads,
} from "./selectors";

function nowIso(): string {
  return new Date().toISOString();
}

export default function App() {
  const [state, dispatch] = useReducer(
    appReducer,
    createInitialState(emptyStore, routeFromHash(window.location.hash)),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<AppUser>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const draftSaveRef = useRef<Promise<void>>(Promise.resolve());
  const selection = useMemo(() => selectVisibleThreads(state), [state]);
  const drafts = useMemo(() => selectVisibleDrafts(state), [state]);
  const currentThread = selectCurrentThread(state);
  const currentAccount =
    currentThread === undefined ? undefined : selectAccountForThread(state, currentThread);
  const currentDraft = selectCurrentDraft(state);
  const draftAccount =
    currentDraft === undefined ? undefined : getAccount(state.store, currentDraft.accountId);

  const replaceStore = (store: MailStore) => dispatch({ type: "replaceStore", store });
  const reportError = (error: unknown) => {
    dispatch({
      type: "toast",
      toast: { kind: "error", message: error instanceof Error ? error.message : "Request failed" },
    });
  };

  const queueDraftSave = (draft: Draft) => {
    const save = draftSaveRef.current
      .catch(() => undefined)
      .then(() => saveRemoteDraft(draft));
    draftSaveRef.current = save;
    return save;
  };

  const refreshStore = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const selectedThreadId = state.route.kind === "mailbox" ? state.route.selectedThreadId : null;
      let result: BootstrapResult;
      try {
        result = await fetchBootstrap(selectedThreadId);
      } catch {
        const { promise, resolve } = Promise.withResolvers<void>();
        window.setTimeout(resolve, 500);
        await promise;
        result = await fetchBootstrap(selectedThreadId);
      }
      replaceStore(result.store);
      setUser(result.user);
      const params = new URLSearchParams(window.location.search);
      if (params.get("gmail") === "connected") {
        dispatch({
          type: "toast",
          toast: {
            kind: params.get("sync") === "failed" ? "error" : "success",
            message: params.get("sync") === "failed" ? "Gmail connected; initial sync failed" : "Gmail connected",
          },
        });
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
      }
    } catch (error) {
      reportError(error);
      setLoadError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshStore();
    if (window.location.hash.length === 0) {
      window.history.replaceState(null, "", routeToHash(state.route));
    }
    const handleHistory = () => dispatch({ type: "navigate", route: routeFromHash(window.location.hash) });
    window.addEventListener("popstate", handleHistory);
    return () => window.removeEventListener("popstate", handleHistory);
  }, []);

  useEffect(() => {
    if (currentDraft === undefined || draftBusy) return undefined;
    const timer = window.setTimeout(() => {
      void queueDraftSave(currentDraft).catch(reportError);
    }, 250);
    const flush = () => {
      void saveRemoteDraft(currentDraft, true).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [currentDraft, draftBusy]);

  useEffect(() => {
    if (state.toast === null) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: "toast", toast: null }), 3200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  const setRoute = (route: Route, mode: "push" | "replace" = "push") => {
    if (mode === "replace") window.history.replaceState(null, "", routeToHash(route));
    else window.history.pushState(null, "", routeToHash(route));
    dispatch({ type: "navigate", route });
  };

  const navigateMailbox = (view: MailboxView, selectedThreadId: ThreadId | null = null) => {
    setRoute({ kind: "mailbox", view, selectedThreadId });
  };

  const connectGmail = () => {
    window.location.assign("/api/oauth/google/start");
  };

  const openThread = (threadId: ThreadId) => {
    const view = state.route.kind === "mailbox" ? state.route.view : "inbox";
    setRoute({ kind: "mailbox", view, selectedThreadId: threadId });
    const thread = state.store.threads.find((item) => item.id === threadId);
    const refresh = thread?.unread === true
      ? mutateRemoteThread(threadId, "read")
      : refreshRemoteThread(threadId);
    void refresh.then(replaceStore).catch(reportError);
  };

  const startCompose = () => {
    dispatch({ type: "composeNew", draftId: createDraftId(), now: nowIso() });
  };

  const composeFromThread = (threadId: ThreadId, mode: "reply" | "replyAll") => {
    dispatch({
      type: "composeFromThread",
      draftId: createDraftId(),
      threadId,
      mode,
      now: nowIso(),
    });
  };

  const applyThreadMutation = async (threadId: ThreadId, mutation: ThreadMutation) => {
    try {
      replaceStore(await mutateRemoteThread(threadId, mutation));
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const moveThread = (threadId: ThreadId, mailbox: "archive" | "trash" | "inbox") => {
    void applyThreadMutation(threadId, mailbox).then(() => {
      if (state.route.kind === "mailbox" && state.route.selectedThreadId === threadId) {
        setRoute({ ...state.route, selectedThreadId: null }, "replace");
      }
    }).catch(() => undefined);
  };

  const toggleThreadStar = (threadId: ThreadId) => {
    const thread = state.store.threads.find((item) => item.id === threadId);
    if (thread === undefined) return;
    void applyThreadMutation(threadId, thread.starred ? "unstar" : "star").catch(() => undefined);
  };

  const setThreadRead = (threadId: ThreadId, read: boolean) => {
    void applyThreadMutation(threadId, read ? "read" : "unread").catch(() => undefined);
  };

  const updateSearch = (query: string) => {
    dispatch({ type: "setSearch", query });
    if (query.trim().length > 0) {
      if (state.route.kind !== "mailbox" || state.route.view !== "search") navigateMailbox("search");
    } else if (state.route.kind === "mailbox" && state.route.view === "search") {
      navigateMailbox("inbox");
    }
  };

  const openAccountFilter = (accountId: AccountId | null) => {
    dispatch({ type: "filterAccount", accountId });
    if (state.route.kind === "settings") navigateMailbox("inbox");
    else if (state.route.selectedThreadId !== null) {
      setRoute({ ...state.route, selectedThreadId: null }, "replace");
    }
  };

  const closeDraft = async () => {
    if (currentDraft === undefined || draftBusy) return;
    setDraftBusy(true);
    try {
      await queueDraftSave(currentDraft);
      dispatch({ type: "draftClose" });
    } catch (error) {
      reportError(error);
    } finally {
      setDraftBusy(false);
    }
  };

  const discardDraft = async () => {
    if (currentDraft === undefined || draftBusy) return;
    setDraftBusy(true);
    try {
      await draftSaveRef.current.catch(() => undefined);
      await deleteRemoteDraft(currentDraft.id);
      dispatch({ type: "draftDelete", draftId: currentDraft.id });
    } catch (error) {
      reportError(error);
    } finally {
      setDraftBusy(false);
    }
  };

  const sendDraft = async () => {
    if (currentDraft === undefined || draftBusy) return;
    const validation = validateDraftRecipients(currentDraft);
    if (validation.kind !== "valid") {
      dispatch({
        type: "toast",
        toast: {
          kind: "error",
          message: validation.kind === "invalid"
            ? `Fix invalid recipient “${validation.values[0]}”`
            : "Add at least one valid recipient",
        },
      });
      return;
    }
    setDraftBusy(true);
    try {
      await queueDraftSave(currentDraft);
      const result = await sendRemoteDraft(currentDraft);
      replaceStore(result.store);
      dispatch({ type: "draftClose" });
      setRoute({ kind: "mailbox", view: "sent", selectedThreadId: result.threadId });
      dispatch({ type: "toast", toast: { kind: "success", message: "Sent with Gmail" } });
    } catch (error) {
      reportError(error);
    } finally {
      setDraftBusy(false);
    }
  };

  const removeAccount = async (account: Account) => {
    if (!window.confirm(`Disconnect ${account.email} and remove its local mail index?`)) return;
    try {
      replaceStore(await disconnectRemoteAccount(account.id));
    } catch (error) {
      reportError(error);
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape") {
        if (state.shortcutHelpOpen) dispatch({ type: "toggleShortcutHelp", open: false });
        else if (state.composer.kind === "confirmIdentity") dispatch({ type: "draftCancelIdentity" });
        else if (state.composer.kind === "editing") void closeDraft();
        else if (state.sidebarOpen) dispatch({ type: "toggleSidebar", open: false });
        return;
      }
      if (state.composer.kind !== "closed" || state.shortcutHelpOpen || state.sidebarOpen) return;
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.key === "Enter" &&
        target instanceof HTMLElement &&
        target.closest("button, a[href], summary, [role='button']") !== null
      ) return;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        dispatch({ type: "toggleShortcutHelp" });
        return;
      }
      if (event.key.toLocaleLowerCase() === "c") {
        event.preventDefault();
        startCompose();
        return;
      }
      if (state.route.kind !== "mailbox") return;
      const selectedId = state.route.selectedThreadId;
      if (event.key.toLocaleLowerCase() === "j" || event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        if (selection.threads.length === 0) return;
        const index = selection.threads.findIndex((thread) => thread.id === selectedId);
        const delta = event.key.toLocaleLowerCase() === "j" ? 1 : -1;
        const fallbackIndex = delta > 0 ? 0 : selection.threads.length - 1;
        const nextIndex = index < 0
          ? fallbackIndex
          : Math.min(Math.max(index + delta, 0), selection.threads.length - 1);
        const nextThread = selection.threads[nextIndex];
        if (nextThread !== undefined) setRoute({ ...state.route, selectedThreadId: nextThread.id });
        return;
      }
      if (selectedId === null) return;
      const selected = state.store.threads.find((thread) => thread.id === selectedId);
      if (selected === undefined) return;
      const key = event.key.toLocaleLowerCase();
      if (event.key === "Enter") {
        event.preventDefault();
        if (selected.unread) setThreadRead(selected.id, true);
      } else if (key === "r" && selected.mailbox !== "trash" && selected.mailbox !== "spam") {
        event.preventDefault();
        composeFromThread(selected.id, "reply");
      } else if (key === "e") {
        event.preventDefault();
        moveThread(
          selected.id,
          selected.mailbox === "archive" || selected.mailbox === "spam" ? "inbox" : "archive",
        );
      } else if (event.key === "#") {
        event.preventDefault();
        moveThread(selected.id, "trash");
      } else if (key === "s") {
        event.preventDefault();
        toggleThreadStar(selected.id);
      } else if (key === "u") {
        event.preventDefault();
        setThreadRead(selected.id, false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [state, selection.threads]);

  if (loading) return <div className="app-loading">Loading</div>;
  if (loadError !== null) {
    return (
      <div className="app-loading">
        <div className="app-load-error">
          <span>Could not load Gmail</span>
          <button className="secondary-button" type="button" onClick={() => void refreshStore()}>Retry</button>
        </div>
      </div>
    );
  }
  const connectLabel = user === null ? "Sign in with Gmail" : "Connect Gmail";
  const appShellClass = `app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}${
    state.route.kind === "mailbox" && state.route.selectedThreadId !== null ? " app-shell--reader-open" : ""
  }`;



  return (
    <div className={appShellClass}>
      <Sidebar
        state={state}
        collapsed={sidebarCollapsed}
        onNavigate={(view) => {
          dispatch({ type: "filterAccount", accountId: null });
          navigateMailbox(view);
        }}
        onSettings={() => setRoute({ kind: "settings" })}
        onCompose={startCompose}
        onConnect={connectGmail}
        onAccountFilter={openAccountFilter}
        onClose={() => dispatch({ type: "toggleSidebar", open: false })}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />

      {state.sidebarOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          onClick={() => dispatch({ type: "toggleSidebar", open: false })}
          aria-label="Dismiss navigation"
        />
      ) : null}

      {state.route.kind === "settings" ? (
        <SettingsView
          state={state}
          onMenu={() => dispatch({ type: "toggleSidebar", open: true })}
          onConnect={connectGmail}
          onSync={(accountId) => {
            void syncAccount(accountId).then(replaceStore).catch(reportError);
          }}
          onRemove={(account) => {
            void removeAccount(account);
          }}
          onDefaultAccount={(accountId) => {
            void setRemoteDefaultAccount(accountId).then(replaceStore).catch(reportError);
          }}
        />
      ) : (
        <>
          <ThreadList
            state={state}
            threads={selection.threads}
            drafts={drafts}
            parsedSearch={selection.parsedSearch}
            searchInputRef={searchInputRef}
            onMenu={() => dispatch({ type: "toggleSidebar", open: true })}
            onSearchChange={updateSearch}
            onConnect={connectGmail}
            connectLabel={connectLabel}
            onOpenThread={openThread}
            onOpenDraft={(draft) => dispatch({ type: "draftOpen", draftId: draft.id })}
            onToggleStar={toggleThreadStar}
          />
          <ThreadReader
            thread={currentThread}
            account={currentAccount}
            onBack={() => {
              if (state.route.kind === "mailbox") setRoute({ ...state.route, selectedThreadId: null }, "replace");
            }}
            onMove={moveThread}
            onToggleStar={toggleThreadStar}
            onSetRead={setThreadRead}
            onComposeFromThread={composeFromThread}
          />
        </>
      )}

      <button className="mobile-compose" type="button" onClick={startCompose} aria-label="New message" disabled={state.store.accounts.length === 0}>
        <PenLine size={20} />
      </button>

      {currentDraft !== undefined && draftAccount !== undefined ? (
        <Composer
          draft={currentDraft}
          account={draftAccount}
          accounts={state.store.accounts}
          composer={state.composer}
          busy={draftBusy}
          onPatch={(patch: DraftPatch) => dispatch({ type: "draftPatch", draftId: currentDraft.id, patch, now: nowIso() })}
          onClose={() => {
            void closeDraft();
          }}
          onDelete={() => {
            void discardDraft();
          }}
          onRequestIdentity={(targetAccountId) => dispatch({ type: "draftRequestIdentity", draftId: currentDraft.id, targetAccountId })}
          onCancelIdentity={() => dispatch({ type: "draftCancelIdentity" })}
          onConfirmIdentity={() => dispatch({ type: "draftConfirmIdentity" })}
          onSend={() => {
            void sendDraft();
          }}
        />
      ) : null}

      {state.shortcutHelpOpen ? (
        <ShortcutHelp onClose={() => dispatch({ type: "toggleShortcutHelp", open: false })} />
      ) : null}

      {state.toast === null ? null : <Toast toast={state.toast} onClose={() => dispatch({ type: "toast", toast: null })} />}
      <div className="sr-only" aria-live="polite">{state.toast?.message ?? ""}</div>
    </div>
  );
}
