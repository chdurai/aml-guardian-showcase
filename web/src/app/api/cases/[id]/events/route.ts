import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
const upstream = process.env.AML_API_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ detail: "Case route not found." }, { status: 404 });
  const headers = new Headers({ Accept: "text/event-stream" });
  const lastId = request.headers.get("last-event-id");
  if (lastId !== null) {
    if (!/^\d+$/.test(lastId))
      return NextResponse.json({ detail: "Last-Event-ID must be a nonnegative integer." }, { status: 400 });
    headers.set("Last-Event-ID", lastId);
  }
  try {
    const response = await fetch(`${upstream}/api/v1/cases/${id}/events`, {
      headers, cache: "no-store", signal: request.signal,
    });
    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
      });
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel();
      return NextResponse.json({ detail: "The API returned an incompatible event stream." }, { status: 502 });
    }
    // Pass the stream through: no buffering, eager reader, or synthetic success events.
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no" },
    });
  } catch {
    return NextResponse.json({ detail: request.signal.aborted ? "Event stream request cancelled." : "Cannot reach the investigation event stream." },
      { status: request.signal.aborted ? 499 : 503 });
  }
}
