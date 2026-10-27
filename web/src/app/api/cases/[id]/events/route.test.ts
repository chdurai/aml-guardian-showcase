import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const id = "b674a917-7547-42f9-9322-2d541cc1c637";
const context = { params: Promise.resolve({ id }) };
const url = `http://localhost/api/cases/${id}/events`;

describe("same-origin case event stream proxy", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("forwards event bytes immediately, preserves keepalives, and passes abort and replay headers", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel });
    const upstream = new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    const fetcher = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetcher);
    const request = new NextRequest(url, { headers: { "Last-Event-ID": "12" } });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.body).toBe(upstream.body);
    const options = fetcher.mock.calls[0][1];
    expect(options.signal).toBe(request.signal);
    expect(options.headers.get("last-event-id")).toBe("12");
    expect(options.cache).toBe("no-store");
    const reader = response.body!.getReader();
    const bytes = ": keepalive\n\nid: 13\nevent: case\ndata: {}\n\n";
    controller.enqueue(new TextEncoder().encode(bytes));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(bytes);
    await reader.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([404, 422, 503])("does not turn upstream %s errors into successful streams", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"upstream failure"}', {
      status, headers: { "Content-Type": "application/json" },
    })));
    const response = await GET(new NextRequest(url), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ detail: "upstream failure" });
  });
  it("rejects invalid case IDs and event cursors before calling upstream", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(new NextRequest(url), { params: Promise.resolve({ id: "bad" }) })).status).toBe(404);
    expect((await GET(new NextRequest(url, { headers: { "Last-Event-ID": "NaN" } }), context)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects incompatible successful responses and reports connection failures", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json" } }))
      .mockRejectedValueOnce(new Error("connection refused"));
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(new NextRequest(url), context)).status).toBe(502);
    expect((await GET(new NextRequest(url), context)).status).toBe(503);
  });
  it("distinguishes an aborted downstream request from upstream unavailability", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("aborted")));
    const abort = new AbortController();
    const request = new NextRequest(url, { signal: abort.signal });
    abort.abort();
    expect((await GET(request, context)).status).toBe(499);
  });
});
