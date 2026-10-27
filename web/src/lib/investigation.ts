import type { Case } from "./contracts";

export function executionSteps(item: Pick<Case, "events" | "status" | "investigator">) {
  let investigatorSeen = false;
  return item.events.filter(event => {
    if (event.phase !== "started") return false;
    if (event.node !== "investigator") return true;
    if (investigatorSeen) return false;
    investigatorSeen = true;
    return true;
  }).map(start => {
    const completions = item.events.filter(event =>
      event.node === start.node && event.phase === "completed" && event.sequence > start.sequence);
    if (start.node !== "investigator") return { start, end: completions[0] };
    // Tool progress shares the investigator node, but is not another graph step.
    const stillRunning = item.status === "running" && item.investigator?.mode === "partial" &&
      !item.events.some(event => event.phase === "started" && event.node !== "investigator" && event.sequence > start.sequence);
    return { start, end: stillRunning ? undefined : completions.at(-1) };
  });
}

export function flowTotals(item: Case) {
  const incoming = item.transactions.filter(t => t.target === item.account).reduce((sum, t) => sum + t.amount, 0);
  const outgoing = item.transactions.filter(t => t.source === item.account).reduce((sum, t) => sum + t.amount, 0);
  return { incoming, outgoing, net: incoming - outgoing };
}

export function scoreContributions(item: Case) {
  const distinctSources = new Set(item.transactions.filter(t => t.target === item.account).map(t => t.source)).size;
  const roundTransfers = item.transactions.filter(t => t.amount >= 20_000 && t.amount % 1000 === 0).length;
  return [
    { label: "Deposits from $9,000 to below $10,000", points: Math.min(item.metrics.structuring_hits * 25, 50) },
    { label: "Incoming graph connections", points: Math.min(item.metrics.fan_in * 5, 20) },
    { label: "Circular transfer paths", points: Math.min(item.metrics.cycles * 25, 50) },
    { label: "Distinct incoming sources", points: Math.min(distinctSources * 10, 30) },
    { label: "Round-dollar transfers of $20,000 or more", points: Math.min(roundTransfers * 10, 20) },
  ];
}

export function outcomeExplanation(item: Case): string {
  if (item.status === "failed") return "The investigation failed; no clean outcome should be inferred. Review the error and refresh the connection.";
  if (item.status === "running") return "The workflow is still running. Wait for the result; you do not need to submit this case again.";
  if (item.recommendation === "HOLD") return "The synthetic party name matched the example screening list. This is an internal stop for human attention—not a confirmed real-world sanctions match or payment block.";
  if (item.recommendation === "FILE_SAR") return "The rules found enough indicators to recommend human consideration of a suspicious activity report. This is not proof of crime, an approval or a filed report.";
  if (item.recommendation === "CLEAR") return "The rules did not reach the escalation threshold. The existing workflow closed automatically; no human approval was recorded. This does not prove that the customer or transaction is risk-free.";
  return "The rules recommend closer human attention. A recommendation explains where to look; it is not a final legal or compliance conclusion.";
}

export type StoryVerdict = { tone: "pending" | "match" | "differ" | "caught" | "partial" | "slipped"; headline: string; detail: string };

export function storyVerdict(item: Case): StoryVerdict {
  const story = item.story;
  if (!story || item.status === "running" || !item.recommendation)
    return { tone: "pending", headline: "Waiting for the team", detail: "The prediction is locked. The agent team is still investigating." };
  if (story.mode === "challenge") {
    if (item.recommendation === "CLEAR")
      return { tone: "slipped", headline: "Slipped past the rules", detail: "The attempt stayed below every scoring threshold. Read the blind spots below—these are gaps in the illustrative rules, not proof of a real-world weakness." };
    if (item.recommendation === "REVIEW")
      return { tone: "partial", headline: "Partly caught", detail: "The team flagged it for human review but not for report consideration." };
    return { tone: "caught", headline: "Caught by the team", detail: "The team escalated the attempt despite the evasion tactic." };
  }
  if (story.prediction === item.recommendation)
    return { tone: "match", headline: "Prediction matched", detail: "The AI's expectation and the deterministic rules reached the same outcome." };
  return { tone: "differ", headline: "Prediction differed", detail: "The rules decided differently from the AI's expectation. The rules are the authority; the difference shows where intuition and policy diverge." };
}

export function recipeSummary(story: NonNullable<Case["story"]>): string[] {
  const r = story.recipe;
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const lines = [r.deposit_count
    ? `${r.deposit_count} deposit${r.deposit_count > 1 ? "s" : ""} of ${r.deposit_min === r.deposit_max ? usd(r.deposit_min) : `${usd(r.deposit_min)}–${usd(r.deposit_max)}`} from ${r.source_count} sender${r.source_count > 1 ? "s" : ""} over ${r.span_days} day${r.span_days > 1 ? "s" : ""}`
    : "No incoming deposits"];
  if (r.outflow_percent) lines.push(`${r.outflow_percent}% sent onward${r.round_outflow ? " as a round-thousand amount" : ""}`);
  if (r.return_flow) lines.push("Part of the outflow comes back (circular flow)");
  if (r.screened_party) lines.push("Counterparty on the illustrative screening list");
  return lines;
}
