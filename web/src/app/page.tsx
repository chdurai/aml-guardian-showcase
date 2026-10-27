import { Suspense } from "react";
import Workbench from "./workbench";
export default function Page() {
  return <Suspense fallback={<main className="boot">Opening your workspace…</main>}><Workbench /></Suspense>;
}
