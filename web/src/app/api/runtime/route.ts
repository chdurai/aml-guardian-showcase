import { NextResponse } from "next/server";
import { runtimeSchema } from "@/lib/contracts";

const upstream = process.env.AML_API_URL ?? "http://127.0.0.1:8000";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(`${upstream}/api/v1/runtime`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const parsed = runtimeSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success) return NextResponse.json({ detail: "Runtime information unavailable." }, { status: 502 });
    return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ detail: "Cannot reach the investigation API." }, { status: 503 });
  }
}
