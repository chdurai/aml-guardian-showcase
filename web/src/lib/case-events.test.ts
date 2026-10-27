import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToCase } from "./case-events";
import type { Case } from "./contracts";

const snapshot: Case = {
  id: "case-1", scenario: "routine", account: "ACC-1", originator: "Employer", beneficiary: "Employee",
  window: "", currency: "USD", created_at: "", updated_at: "", status: "running",
  graph_case_id: null, recommendation: null, score: null, transactions: [], findings: [],
  sources: [], metrics: { nodes: 0, fan_in: 0, cycles: 0, structuring_hits: 0 },
  narrative: "", events: [], error: null, investigator: null, reviews: [],
};
class FakeSource extends EventTarget {
  static latest: FakeSource;
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) { super(); FakeSource.latest = this; }
  emit(payload: unknown) { this.dispatchEvent(new MessageEvent("case", { data: JSON.stringify(payload) })); }
}

describe("case snapshot event subscription", () => {
  beforeEach(() => vi.stubGlobal("EventSource", FakeSource));
  afterEach(() => vi.unstubAllGlobals());
  it("subscribes to the same origin and validates every snapshot before updating", () => {
    const update = vi.fn(), failed = vi.fn();
    const close = subscribeToCase("case-1", update, failed);
    expect(FakeSource.latest.url).toBe("/api/cases/case-1/events");
    FakeSource.latest.emit(snapshot);
    expect(update).toHaveBeenCalledWith(snapshot);
    expect(failed).not.toHaveBeenCalled();
    close();
    expect(FakeSource.latest.close).toHaveBeenCalledOnce();
    FakeSource.latest.emit(snapshot);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it.each(["completed", "awaiting_human", "failed"] as const)("publishes the final %s snapshot and closes without reconnecting", status => {
    const update = vi.fn(), failed = vi.fn();
    subscribeToCase(snapshot.id, update, failed);
    FakeSource.latest.emit({ ...snapshot, status });
    expect(update).toHaveBeenCalledWith({ ...snapshot, status });
    expect(FakeSource.latest.close).toHaveBeenCalledOnce();
    FakeSource.latest.onerror?.();
    expect(failed).not.toHaveBeenCalled();
  });
  it.each([{ ...snapshot, id: "other" }, { ...snapshot, status: "approved" }])("rejects an incompatible or mismatched snapshot", payload => {
    const update = vi.fn(), failed = vi.fn();
    subscribeToCase(snapshot.id, update, failed);
    FakeSource.latest.emit(payload);
    expect(update).not.toHaveBeenCalled();
    expect(FakeSource.latest.close).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(expect.stringContaining("Polling will continue"));
  });
  it("closes once on network failure, leaves polling available and ignores later events", () => {
    const update = vi.fn(), failed = vi.fn();
    subscribeToCase(snapshot.id, update, failed);
    FakeSource.latest.onerror?.();
    FakeSource.latest.onerror?.();
    FakeSource.latest.emit(snapshot);
    expect(FakeSource.latest.close).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
  it("provides an explicit polling fallback when EventSource is unsupported", () => {
    vi.stubGlobal("EventSource", undefined);
    const failed = vi.fn();
    expect(() => subscribeToCase(snapshot.id, vi.fn(), failed)).not.toThrow();
    expect(failed).toHaveBeenCalledWith(expect.stringContaining("Polling will continue"));
  });
  it("rejects malformed JSON without updating the cache", () => {
    const update = vi.fn(), failed = vi.fn();
    subscribeToCase(snapshot.id, update, failed);
    FakeSource.latest.dispatchEvent(new MessageEvent("case", { data: "not JSON" }));
    expect(update).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(FakeSource.latest.close).toHaveBeenCalledOnce();
  });
  it("allows cleanup before switching cases without leaking old snapshots or errors", () => {
    const oldUpdate = vi.fn(), update = vi.fn(), failed = vi.fn();
    const stop = subscribeToCase(snapshot.id, oldUpdate, failed);
    const old = FakeSource.latest;
    stop();
    const stopNext = subscribeToCase("case-2", update, failed);
    old.emit(snapshot);
    old.onerror?.();
    FakeSource.latest.emit({ ...snapshot, id: "case-2" });
    expect(oldUpdate).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ ...snapshot, id: "case-2" });
    stopNext();
  });
});
