import type { Account, MailThread } from "./model";
import { threadHasAttachments } from "./model";

export type SearchPredicate =
  | { kind: "text"; value: string }
  | { kind: "from"; value: string }
  | { kind: "to"; value: string }
  | { kind: "account"; value: string }
  | { kind: "subject"; value: string }
  | { kind: "is"; value: "read" | "unread" | "starred" }
  | { kind: "has"; value: "attachment" }
  | { kind: "after" | "before"; epochMs: number; label: string };

export type ParsedSearch = {
  predicates: SearchPredicate[];
  errors: string[];
};

const TOKEN_PATTERN = /"([^"]+)"|(\S+)/g;

export function parseSearch(query: string): ParsedSearch {
  const predicates: SearchPredicate[] = [];
  const errors: string[] = [];

  for (const match of query.matchAll(TOKEN_PATTERN)) {
    const token = (match[1] ?? match[2] ?? "").trim();
    if (token.length === 0) continue;

    const separator = token.indexOf(":");
    if (separator < 1) {
      predicates.push({ kind: "text", value: token });
      continue;
    }

    const key = token.slice(0, separator).toLocaleLowerCase();
    const value = token.slice(separator + 1).trim();
    if (value.length === 0) {
      errors.push(`“${key}:” needs a value`);
      continue;
    }

    if (key === "from" || key === "to" || key === "account" || key === "subject") {
      predicates.push({ kind: key, value });
      continue;
    }
    if (key === "is") {
      if (value === "read" || value === "unread" || value === "starred") {
        predicates.push({ kind: "is", value });
      } else {
        errors.push(`Unknown state “is:${value}”`);
      }
      continue;
    }
    if (key === "has") {
      if (value === "attachment") predicates.push({ kind: "has", value });
      else errors.push(`Unknown property “has:${value}”`);
      continue;
    }
    if (key === "after" || key === "before") {
      const epochMs = Date.parse(value);
      if (Number.isNaN(epochMs)) errors.push(`Invalid date “${value}”`);
      else predicates.push({ kind: key, epochMs, label: value });
      continue;
    }

    predicates.push({ kind: "text", value: token });
  }

  return { predicates, errors };
}

function includesNormalized(source: string, query: string): boolean {
  return source.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function senderHaystack(thread: MailThread): string {
  return thread.messages
    .map((message) => `${message.from.name} ${message.from.email}`)
    .join(" ");
}

function recipientHaystack(thread: MailThread): string {
  return thread.messages
    .flatMap((message) => [...message.to, ...message.cc])
    .map((address) => `${address.name} ${address.email}`)
    .join(" ");
}

function textHaystack(thread: MailThread): string {
  const bodies = thread.messages.map((message) => message.body).join(" ");
  return `${thread.subject} ${thread.snippet} ${senderHaystack(thread)} ${recipientHaystack(thread)} ${bodies}`;
}

function matchesPredicate(
  thread: MailThread,
  account: Account | undefined,
  predicate: SearchPredicate,
): boolean {
  switch (predicate.kind) {
    case "text":
      return includesNormalized(textHaystack(thread), predicate.value);
    case "from":
      return includesNormalized(senderHaystack(thread), predicate.value);
    case "to":
      return includesNormalized(recipientHaystack(thread), predicate.value);
    case "subject":
      return includesNormalized(thread.subject, predicate.value);
    case "account":
      return account !== undefined && includesNormalized(
        `${account.badgeLabel} ${account.displayName} ${account.email}`,
        predicate.value,
      );
    case "is":
      if (predicate.value === "unread") return thread.unread;
      if (predicate.value === "read") return !thread.unread;
      return thread.starred;
    case "has":
      return threadHasAttachments(thread);
    case "after":
      return Date.parse(thread.lastMessageAt) >= predicate.epochMs;
    case "before":
      return Date.parse(thread.lastMessageAt) < predicate.epochMs;
    default: {
      const exhaustive: never = predicate;
      return exhaustive;
    }
  }
}

export function searchThreads(
  threads: MailThread[],
  accounts: Account[],
  query: string,
): { threads: MailThread[]; parsed: ParsedSearch } {
  const parsed = parseSearch(query);
  if (parsed.predicates.length === 0) return { threads, parsed };

  const results = threads.filter((thread) => {
    const account = accounts.find((item) => item.id === thread.accountId);
    return parsed.predicates.every((predicate) => matchesPredicate(thread, account, predicate));
  });
  return { threads: results, parsed };
}

