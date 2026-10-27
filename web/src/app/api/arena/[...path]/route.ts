import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { arenaJobSchema, createArenaSchema, fixtureSchema } from "../../../../lib/arena";
import { isSameOrigin } from "../../../../lib/origin";

export const dynamic = "force-dynamic";
const upstream = process.env.AML_API_URL ?? "http://127.0.0.1:8000";

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const fixtures = path.length === 1 && path[0] === "fixtures";
  const create = path.length === 1 && path[0] === "runs";
  const run = path[0] === "runs" && z.uuid().safeParse(path[1]).success;
  const stream = run && path.length === 3 && path[2] === "events";
  if (!(fixtures || create || (run && path.length === 2) || stream))
    return NextResponse.json({ detail: "Arena route not found." }, { status: 404 });
  if (stream && !/^\d+$/.test(request.headers.get("last-event-id") ?? "0"))
    return NextResponse.json({ detail: "Last-Event-ID must be a nonnegative integer." }, { status: 400 });
  let body: string | undefined;
  if (request.method === "POST") {
    if (!create) return NextResponse.json({ detail: "Action not supported." }, { status: 405 });
    if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"), request.nextUrl.protocol))
      return NextResponse.json({ detail: "A same-origin request is required." }, { status: 403 });
    let input: unknown;
    try { input = await request.json(); }
    catch { return NextResponse.json({ detail: "Invalid JSON request." }, { status: 400 }); }
    const parsed = createArenaSchema.safeParse(input);
    if (!parsed.success) return NextResponse.json({ detail: "Choose a supported arena mode and fixture." }, { status: 422 });
    body = JSON.stringify(parsed.data);
  } else if (create) return NextResponse.json({ detail: "Action not supported." }, { status: 405 });
  try {
    const signal = stream ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const response = await fetch(`${upstream}/api/v1/arena/${path.join("/")}`, {
      method: request.method, body, cache: "no-store", signal,
      headers: { "Content-Type": "application/json", ...(stream ? {
        "Last-Event-ID": request.headers.get("last-event-id") ?? "0",
      } : {}) },
    });
    if (stream && response.ok) {
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body)
        return NextResponse.json({ detail: "Invalid arena event stream." }, { status: 502 });
      return new Response(response.body, { headers: {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
      } });
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) {
      if (request.signal.aborted) throw error;
      console.error("Malformed arena upstream JSON", error);
      return NextResponse.json({ detail: "Arena API returned malformed JSON." }, { status: 502 });
    }
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(payload);
      return NextResponse.json({ detail: error.success ? error.data.detail : "Arena API rejected request." },
        { status: response.status });
    }
    const parsed = (fixtures ? z.array(fixtureSchema) : arenaJobSchema).safeParse(payload);
    if (!parsed.success) {
      console.error("Incompatible arena projection", parsed.error.message);
      return NextResponse.json({ detail: "Arena API returned an incompatible response." }, { status: 502 });
    }
    return NextResponse.json(parsed.data, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted)
      return NextResponse.json({ detail: "Arena request cancelled." }, { status: 499 });
    console.error("Arena upstream connection failed", error);
    return NextResponse.json({ detail: "Cannot reach Arena API. Check the Python service and arena flag." }, { status: 503 });
  }
}
export const GET = forward;
export const POST = forward;
