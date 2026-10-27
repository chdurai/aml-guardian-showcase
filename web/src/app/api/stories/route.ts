import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { caseSchema, createStorySchema } from "@/lib/contracts";
import { isSameOrigin } from "@/lib/origin";

const upstream = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"), request.nextUrl.protocol))
    return NextResponse.json({ detail: "A same-origin request is required." }, { status: 403 });
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ detail: "Invalid JSON request." }, { status: 400 }); }
  const parsed = createStorySchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ detail: parsed.error.issues[0]?.message ?? "Unsupported story request." }, { status: 422 });
  try {
    // The local model may need up to a few minutes on a laptop (three red-team rounds).
    const response = await fetch(`${upstream}/api/v1/stories`, {
      method: "POST", body: JSON.stringify(parsed.data), headers: { "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(280_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(payload);
      return NextResponse.json({ detail: error.success ? error.data.detail : "The story designer rejected the request." }, { status: response.status });
    }
    const story = caseSchema.safeParse(payload);
    if (!story.success) {
      console.error("Invalid story API response", story.error.message);
      return NextResponse.json({ detail: "The API returned an incompatible response." }, { status: 502 });
    }
    return NextResponse.json(story.data, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Story API connection failed", error);
    return NextResponse.json({ detail: "Cannot reach the investigation API, or the story designer took too long." }, { status: 503 });
  }
}
