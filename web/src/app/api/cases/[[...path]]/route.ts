import { NextRequest, NextResponse } from "next/server";
import { caseSchema, createCaseSchema, decisionSchema } from "@/lib/contracts";
import { z } from "zod";
import { isSameOrigin } from "@/lib/origin";

const upstream = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";

async function forward(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const decision = path.length === 2 && path[1] === "decision";
  if (path.length > 2 || (path.length === 2 && !decision) || (path[0] && !z.uuid().safeParse(path[0]).success))
    return NextResponse.json({ detail: "Case route not found." }, { status: 404 });
  if (decision && request.method !== "POST")
    return NextResponse.json({ detail: "Use POST to record a decision." }, { status: 405 });
  let body: string | undefined;
  if (request.method === "POST") {
    if (path.length === 1) return NextResponse.json({ detail: "Action not supported." }, { status: 405 });
    const origin = request.headers.get("origin");
    if (!isSameOrigin(origin, request.headers.get("host"), request.nextUrl.protocol))
      return NextResponse.json({ detail: "A same-origin request is required." }, { status: 403 });
    let input: unknown;
    try { input = await request.json(); }
    catch { return NextResponse.json({ detail: "Invalid JSON request." }, { status: 400 }); }
    const parsed = decision ? decisionSchema.safeParse(input) : createCaseSchema.safeParse(input);
    if (!parsed.success) return NextResponse.json({ detail: decision
      ? "Choose an action, enter your name, write a rationale of at least 20 characters and confirm you reviewed the evidence."
      : "Choose a supported synthetic scenario." }, { status: 422 });
    body = JSON.stringify(parsed.data);
  }
  try {
    const response = await fetch(`${upstream}/api/v1/cases${path.length ? `/${path.join("/")}` : ""}`, {
      method: request.method, body, headers: { "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(payload);
      return NextResponse.json({ detail: error.success ? error.data.detail : "Investigation API rejected the request." },
        { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    const parsed = (path.length || request.method === "POST" ? caseSchema : z.array(caseSchema)).safeParse(payload);
    if (!parsed.success) {
      console.error("Invalid investigation API response", parsed.error.message);
      return NextResponse.json({ detail: "The API returned an incompatible response." }, { status: 502 });
    }
    return NextResponse.json(parsed.data, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Investigation API connection failed", error);
    return NextResponse.json({ detail: "Cannot reach the investigation API. Check that the Python service is running." }, { status: 503 });
  }
}
export const GET = forward;
export const POST = forward;
