import { beforeEach, describe, expect, it } from "vitest";

import {
  buildApplicationRecord,
  checkDuplicates,
  clearApplications,
  companyTitleKey,
  computeFollowUpAt,
  deleteApplication,
  describeDuplicates,
  dueFollowUps,
  findDuplicates,
  inputFromJobContext,
  insertApplication,
  listApplications,
  logApplication,
  MAX_APPLICATIONS,
  normaliseUrl,
  pendingFollowUps,
  removeApplication,
  setApplicationStatus,
  statusCounts,
  toCsv,
  updateApplicationNotes,
  updateApplicationStatus,
} from "@/lib/tracker";
import type { ApplicationRecord } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fake chrome.storage.local — the real AES-GCM path in storage.ts runs on top
// of this, so these tests also prove nothing is persisted in plaintext.
// ---------------------------------------------------------------------------

const backing = new Map<string, unknown>();

const fakeChrome = {
  runtime: { id: "phaselytestextensionid", lastError: undefined },
  storage: {
    local: {
      get(key: string, cb: (items: Record<string, unknown>) => void) {
        cb(backing.has(key) ? { [key]: backing.get(key) } : {});
      },
      set(items: Record<string, unknown>, cb: () => void) {
        for (const [k, v] of Object.entries(items)) backing.set(k, v);
        cb();
      },
      clear(cb: () => void) {
        backing.clear();
        cb();
      },
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = fakeChrome;

const MS_PER_DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);

function record(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: "r1",
    company: "Acme",
    title: "Backend Engineer",
    location: "Remote",
    url: "https://boards.acme.com/jobs/123",
    appliedAt: T0,
    status: "applied",
    lastStatusAt: T0,
    followUpAt: T0 + 7 * MS_PER_DAY,
    notes: "",
    ghostScore: null,
    fieldsFilled: 12,
    ...overrides,
  };
}

beforeEach(() => {
  backing.clear();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normaliseUrl", () => {
  it("ignores scheme, www, trailing slash, fragment and tracking params", () => {
    const a = normaliseUrl("https://www.Boards.acme.com/jobs/123/?utm_source=linkedin#apply");
    const b = normaliseUrl("http://boards.acme.com/jobs/123");
    expect(a).toBe(b);
  });

  it("keeps params that identify the posting", () => {
    expect(normaliseUrl("https://acme.com/careers?gh_jid=111")).not.toBe(
      normaliseUrl("https://acme.com/careers?gh_jid=222"),
    );
  });

  it("is insensitive to param order", () => {
    expect(normaliseUrl("https://a.com/j?b=2&a=1")).toBe(normaliseUrl("https://a.com/j?a=1&b=2"));
  });

  it("degrades gracefully on junk", () => {
    expect(normaliseUrl("not a url/")).toBe("not a url");
    expect(normaliseUrl("")).toBe("");
  });
});

describe("companyTitleKey", () => {
  it("normalises punctuation and case", () => {
    expect(companyTitleKey("Acme, Inc.", "Backend  Engineer")).toBe(
      companyTitleKey("acme inc", "backend engineer"),
    );
  });

  it("treats legal-entity suffixes as noise", () => {
    expect(companyTitleKey("Acme, Inc.", "Backend Engineer")).toBe(
      companyTitleKey("Acme", "Backend Engineer"),
    );
    expect(companyTitleKey("Globex GmbH", "SRE")).toBe(companyTitleKey("Globex", "SRE"));
    // A one-token name that happens to be a suffix word is kept as-is.
    expect(companyTitleKey("Group", "SRE")).toBe("group|sre");
  });

  it("returns an empty key when either half is missing", () => {
    expect(companyTitleKey("", "Backend Engineer")).toBe("");
    expect(companyTitleKey("Acme", "")).toBe("");
  });
});

describe("buildApplicationRecord", () => {
  it("fills the frozen ApplicationRecord shape from scraped context", () => {
    const built = buildApplicationRecord(
      {
        company: " Acme ",
        title: " Backend Engineer ",
        location: "Berlin",
        url: "https://acme.com/j/1",
        fieldsFilled: 9,
        followUpDays: 7,
      },
      T0,
    );

    expect(built).toMatchObject({
      company: "Acme",
      title: "Backend Engineer",
      location: "Berlin",
      url: "https://acme.com/j/1",
      appliedAt: T0,
      lastStatusAt: T0,
      status: "applied",
      followUpAt: T0 + 7 * MS_PER_DAY,
      ghostScore: null,
      fieldsFilled: 9,
      notes: "",
    });
    expect(built.id.length).toBeGreaterThan(0);
  });

  it("stores ghostScore when another feature supplies it, null otherwise", () => {
    expect(buildApplicationRecord({ url: "u", ghostScore: 0.8 }, T0).ghostScore).toBe(0.8);
    expect(buildApplicationRecord({ url: "u" }, T0).ghostScore).toBeNull();
    expect(buildApplicationRecord({ url: "u", ghostScore: null }, T0).ghostScore).toBeNull();
  });

  it("treats followUpDays 0 as nudges disabled", () => {
    expect(buildApplicationRecord({ url: "u", followUpDays: 0 }, T0).followUpAt).toBeNull();
    expect(computeFollowUpAt(T0, -3)).toBeNull();
    expect(computeFollowUpAt(T0, 7)).toBe(T0 + 7 * MS_PER_DAY);
  });

  it("generates distinct ids", () => {
    const a = buildApplicationRecord({ url: "u" }, T0);
    const b = buildApplicationRecord({ url: "u" }, T0);
    expect(a.id).not.toBe(b.id);
  });
});

describe("findDuplicates", () => {
  const existing = [
    record({ id: "r1", url: "https://boards.acme.com/jobs/123" }),
    record({ id: "r2", company: "Globex", title: "SRE", url: "https://globex.com/jobs/9" }),
  ];

  it("matches on canonical URL despite tracking params", () => {
    const hits = findDuplicates(existing, {
      url: "https://www.boards.acme.com/jobs/123?utm_campaign=x",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ reason: "url" });
    expect(hits[0].record.id).toBe("r1");
  });

  it("matches on company + title when the URL differs (repost / other board)", () => {
    const hits = findDuplicates(existing, {
      url: "https://linkedin.com/jobs/view/777",
      company: "ACME Inc.",
      title: "backend engineer",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ reason: "companyTitle" });
  });

  it("reports a record once, preferring the URL reason", () => {
    const hits = findDuplicates(existing, {
      url: "https://boards.acme.com/jobs/123",
      company: "Acme",
      title: "Backend Engineer",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toBe("url");
  });

  it("does not match on a partial scrape", () => {
    expect(findDuplicates(existing, { url: "", company: "Acme", title: "" })).toEqual([]);
    expect(findDuplicates(existing, { url: "https://new.com/x" })).toEqual([]);
  });

  it("skips the excluded id", () => {
    expect(
      findDuplicates(existing, { url: "https://boards.acme.com/jobs/123" }, "r1"),
    ).toEqual([]);
  });

  it("describes the first match for the user", () => {
    const hits = findDuplicates(existing, { url: "https://boards.acme.com/jobs/123" });
    expect(describeDuplicates(hits)).toContain("already applied to this exact posting");
    expect(describeDuplicates([])).toBe("");
  });
});

describe("array helpers", () => {
  it("inserts newest first and caps the log", () => {
    const base = Array.from({ length: MAX_APPLICATIONS }, (_, i) => record({ id: `r${i}` }));
    const next = insertApplication(base, record({ id: "newest" }));
    expect(next[0].id).toBe("newest");
    expect(next).toHaveLength(MAX_APPLICATIONS);
    expect(next.some((r) => r.id === `r${MAX_APPLICATIONS - 1}`)).toBe(false);
  });

  it("stamps lastStatusAt and re-arms the nudge for active statuses", () => {
    const now = T0 + 3 * MS_PER_DAY;
    const [updated] = setApplicationStatus([record()], "r1", "screening", 7, now);
    expect(updated.status).toBe("screening");
    expect(updated.lastStatusAt).toBe(now);
    expect(updated.followUpAt).toBe(now + 7 * MS_PER_DAY);
  });

  it("clears the nudge for terminal statuses", () => {
    for (const status of ["interview", "offer", "rejected", "withdrawn"] as const) {
      const [updated] = setApplicationStatus([record()], "r1", status, 7, T0);
      expect(updated.followUpAt, status).toBeNull();
    }
  });

  it("keeps nudging a ghosted application", () => {
    const [updated] = setApplicationStatus([record()], "r1", "ghosted", 7, T0);
    expect(updated.followUpAt).toBe(T0 + 7 * MS_PER_DAY);
  });

  it("no-ops on unknown ids and does not mutate the input", () => {
    const input = [record()];
    expect(setApplicationStatus(input, "nope", "offer", 7, T0)[0]).toEqual(input[0]);
    expect(removeApplication(input, "nope")).toHaveLength(1);
    expect(input[0].status).toBe("applied");
  });

  it("removes by id", () => {
    expect(removeApplication([record({ id: "a" }), record({ id: "b" })], "a")).toHaveLength(1);
  });

  it("splits due and pending follow-ups", () => {
    const records = [
      record({ id: "due", followUpAt: T0 - MS_PER_DAY }),
      record({ id: "later", followUpAt: T0 + MS_PER_DAY }),
      record({ id: "none", followUpAt: null }),
    ];
    expect(dueFollowUps(records, T0).map((r) => r.id)).toEqual(["due"]);
    expect(pendingFollowUps(records, T0).map((r) => r.id)).toEqual(["later"]);
  });

  it("counts statuses", () => {
    const counts = statusCounts([record({ id: "a" }), record({ id: "b", status: "offer" })]);
    expect(counts.applied).toBe(1);
    expect(counts.offer).toBe(1);
    expect(counts.ghosted).toBe(0);
  });

  it("maps a scraped JobContext onto tracker input", () => {
    const input = inputFromJobContext(
      {
        title: "Backend Engineer",
        company: "Acme",
        location: "Berlin",
        description: "a very long posting body",
        url: "https://acme.com/j/1",
      },
      "https://fallback.example/x",
      { fieldsFilled: 4, ghostScore: 0.2, followUpDays: 7 },
    );

    expect(input).toEqual({
      company: "Acme",
      title: "Backend Engineer",
      location: "Berlin",
      url: "https://acme.com/j/1",
      fieldsFilled: 4,
      ghostScore: 0.2,
      followUpDays: 7,
    });
  });

  it("falls back to the supplied url when there is no job context", () => {
    expect(inputFromJobContext(null, "https://fallback.example/x").url).toBe(
      "https://fallback.example/x",
    );
  });

  it("exports CSV with escaped quotes and a header row", () => {
    const csv = toCsv([record({ notes: 'said "hello"' })]);
    const [header, row] = csv.split("\n");
    expect(header.startsWith("company,title,location,url")).toBe(true);
    expect(row).toContain('"said ""hello"""');
  });
});

// ---------------------------------------------------------------------------
// Encrypted CRUD — exercises the real AES-GCM storage path
// ---------------------------------------------------------------------------

describe("tracker CRUD over encrypted storage", () => {
  it("reads an empty log before anything is written", async () => {
    expect(await listApplications()).toEqual([]);
  });

  it("logs an application and reads it back", async () => {
    const { record: saved, duplicates } = await logApplication(
      {
        company: "Acme",
        title: "Backend Engineer",
        location: "Berlin",
        url: "https://acme.com/j/1",
        fieldsFilled: 11,
        followUpDays: 7,
      },
      T0,
    );

    expect(duplicates).toEqual([]);

    const stored = await listApplications();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(saved.id);
    expect(stored[0].company).toBe("Acme");
    expect(stored[0].followUpAt).toBe(T0 + 7 * MS_PER_DAY);
  });

  it("never persists the log in plaintext", async () => {
    await logApplication({ company: "Acme", title: "Backend Engineer", url: "https://acme.com/j/1" }, T0);

    const raw = JSON.stringify(backing.get("applications"));
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("Acme");
    expect(raw).not.toContain("Backend Engineer");
    expect(raw).toContain("iv");
  });

  it("warns about a duplicate on the second apply but still records it", async () => {
    await logApplication({ company: "Acme", title: "Backend Engineer", url: "https://acme.com/j/1" }, T0);

    const second = await logApplication(
      { company: "Acme", title: "Backend Engineer", url: "https://www.acme.com/j/1?utm_source=x" },
      T0 + MS_PER_DAY,
    );

    expect(second.duplicates).toHaveLength(1);
    expect(second.duplicates[0].reason).toBe("url");
    expect(await listApplications()).toHaveLength(2);
  });

  it("checks duplicates before applying", async () => {
    await logApplication({ company: "Acme", title: "Backend Engineer", url: "https://acme.com/j/1" }, T0);

    expect(await checkDuplicates({ url: "https://acme.com/j/1" })).toHaveLength(1);
    expect(await checkDuplicates({ url: "https://acme.com/j/other" })).toHaveLength(0);
  });

  it("sorts the log newest first", async () => {
    await logApplication({ company: "Older", title: "A", url: "https://a.com/1" }, T0 - MS_PER_DAY);
    await logApplication({ company: "Newer", title: "B", url: "https://b.com/1" }, T0);

    expect((await listApplications()).map((r) => r.company)).toEqual(["Newer", "Older"]);
  });

  it("updates a status and clears the nudge for terminal ones", async () => {
    const { record: saved } = await logApplication(
      { company: "Acme", title: "Backend Engineer", url: "https://acme.com/j/1", followUpDays: 7 },
      T0,
    );

    const updated = await updateApplicationStatus(saved.id, "rejected", 7, T0 + MS_PER_DAY);
    expect(updated?.status).toBe("rejected");
    expect(updated?.followUpAt).toBeNull();
    expect(updated?.lastStatusAt).toBe(T0 + MS_PER_DAY);

    expect((await listApplications())[0].status).toBe("rejected");
  });

  it("returns null when updating an unknown id", async () => {
    expect(await updateApplicationStatus("missing", "offer")).toBeNull();
  });

  it("patches notes", async () => {
    const { record: saved } = await logApplication({ company: "Acme", title: "A", url: "https://a.com/1" }, T0);
    const updated = await updateApplicationNotes(saved.id, "referred by Dana");
    expect(updated?.notes).toBe("referred by Dana");
    expect(await updateApplicationNotes("missing", "x")).toBeNull();
  });

  it("deletes a record", async () => {
    const { record: saved } = await logApplication({ company: "Acme", title: "A", url: "https://a.com/1" }, T0);

    expect(await deleteApplication(saved.id)).toBe(true);
    expect(await listApplications()).toEqual([]);
    expect(await deleteApplication(saved.id)).toBe(false);
  });

  it("clears the whole log", async () => {
    await logApplication({ company: "Acme", title: "A", url: "https://a.com/1" }, T0);
    await clearApplications();
    expect(await listApplications()).toEqual([]);
  });

  it("degrades to an empty log when the stored blob is corrupt", async () => {
    backing.set("applications", { iv: "!!!not-base64!!!", data: "garbage" });
    expect(await listApplications()).toEqual([]);
  });
});
