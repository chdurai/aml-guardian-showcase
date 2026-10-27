import { Case, caseSchema } from "./contracts";

export function subscribeToCase(id: string, update: (item: Case) => void, failed: (message: string) => void) {
  let source: EventSource | undefined;
  let closed = false;
  const close = () => { closed = true; source?.close(); };
  const fail = (message: string) => {
    if (closed) return;
    close();
    failed(`${message} Polling will continue; live updates will not reconnect automatically.`);
  };
  try {
    source = new EventSource(`/api/cases/${encodeURIComponent(id)}/events`);
    source.addEventListener("case", event => {
      if (closed) return;
      let item: Case;
      try {
        item = caseSchema.parse(JSON.parse((event as MessageEvent<string>).data));
        if (item.id !== id) throw new Error("Mismatched case");
      } catch {
        fail("Live updates returned an incompatible case snapshot.");
        return;
      }
      if (item.status !== "running") close();
      update(item);
    });
    source.onerror = () => fail("Live case updates disconnected.");
  } catch {
    fail("Live case updates are unavailable.");
  }
  return close;
}
