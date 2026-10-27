import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const id = "b674a917-7547-42f9-9322-2d541cc1c637";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
afterEach(() => vi.unstubAllGlobals());

it.each([404, 422, 429, 503])("preserves upstream %s errors", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"explicit failure"}', { status })));
  const response = await GET(new NextRequest("http://localhost/api/arena/fixtures"), context(["fixtures"]));
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ detail: "explicit failure" });
});
it("rejects cross-origin writes and unsupported paths without upstream calls", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const request = new NextRequest("http://localhost/api/arena/runs", { method: "POST",
    headers: { host: "localhost", origin: "http://evil.invalid" }, body: '{"fixture_id":"dev-01","mode":"compare"}' });
  expect((await POST(request, context(["runs"]))).status).toBe(403);
  expect((await GET(new NextRequest("http://localhost/api/arena/wrong"), context(["wrong"]))).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects malformed projections", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}")).mockResolvedValueOnce(new Response("not-json"));
  vi.stubGlobal("fetch", fetcher);
  expect((await GET(new NextRequest("http://localhost/api/arena/fixtures"), context(["fixtures"]))).status).toBe(502);
  expect((await GET(new NextRequest("http://localhost/api/arena/fixtures"), context(["fixtures"]))).status).toBe(502);
});
it("forwards stream bytes and cancellation without buffering", async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("event: arena\n\n")); c.close(); } });
  const fetcher = vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetcher);
  const request = new NextRequest(`http://localhost/api/arena/runs/${id}/events`, { headers: { "Last-Event-ID": "7" } });
  const response = await GET(request, context(["runs", id, "events"]));
  expect(response.body).toBe(body);
  expect(fetcher.mock.calls[0][1].signal).toBe(request.signal);
  expect(fetcher.mock.calls[0][1].headers["Last-Event-ID"]).toBe("7");
});

it("rejects bad cursors locally and distinguishes downstream cancellation", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("aborted"));
  vi.stubGlobal("fetch", fetcher);
  const url = `http://localhost/api/arena/runs/${id}/events`;
  expect((await GET(new NextRequest(url, { headers: { "Last-Event-ID": "NaN" } }),
    context(["runs", id, "events"]))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const controller = new AbortController();
  const request = new NextRequest(url, { signal: controller.signal });
  controller.abort();
  expect((await GET(request, context(["runs", id, "events"]))).status).toBe(499);
});
