import { describe, it, expect } from "vitest";
import { isUnread } from "./dashboard";

const session = { id: "abc123", projectSlug: "c--work-git-foo", lastActivity: "2026-06-19T10:00:00Z" };

describe("isUnread", () => {
  it("is unread when readState has no entry for this session", () => {
    expect(isUnread(session, {})).toBe(true);
  });

  it("is unread when lastActivity is newer than the read timestamp", () => {
    expect(isUnread(session, { "c--work-git-foo/abc123": "2026-06-19T09:00:00Z" })).toBe(true);
  });

  it("is read when lastActivity equals the read timestamp", () => {
    expect(isUnread(session, { "c--work-git-foo/abc123": "2026-06-19T10:00:00Z" })).toBe(false);
  });

  it("is read when lastActivity is older than the read timestamp", () => {
    expect(isUnread(session, { "c--work-git-foo/abc123": "2026-06-19T11:00:00Z" })).toBe(false);
  });

  it("ignores a project-level key — session-level key is required", () => {
    expect(isUnread(session, { "c--work-git-foo": "2026-06-19T11:00:00Z" })).toBe(true);
  });
});
