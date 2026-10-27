import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { policyAnswerSchema, policyQuestionSchema } from "@/lib/contracts";
import { isSameOrigin } from "@/lib/origin";

const upstream = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"), request.nextUrl.protocol))
    return NextResponse.json({ detail: "A same-origin request is required." }, { status: 403 });
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ detail: "Invalid JSON request." }, { status: 400 }); }
  const parsed = policyQuestionSchema.safeParse(input);
  if (!parsed.success)
    return NextResponse.json({ detail: "Ask a reference question between 5 and 400 characters; customer fields are not accepted." }, { status: 422 });
  try {
    const response = await fetch(`${upstream}/api/v1/policy/ask`, {
      method: "POST", body: JSON.stringify(parsed.data), headers: { "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(135_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(payload);
      return NextResponse.json({ detail: error.success ? error.data.detail : "The reference question was rejected." }, { status: response.status });
    }
    const answer = policyAnswerSchema.safeParse(payload);
    if (!answer.success) {
      console.error("Invalid policy API response", answer.error.message);
      return NextResponse.json({ detail: "The API returned an incompatible reference response." }, { status: 502 });
    }
    return NextResponse.json(answer.data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Policy API connection failed", error);
    return NextResponse.json({ detail: "Cannot reach the policy assistant, or the local model took too long. Retry explicitly." }, { status: 503 });
  }
}
