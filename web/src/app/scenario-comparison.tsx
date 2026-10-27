"use client";

import { Button } from "@mui/material";
import { Case, recommendations, scenarios, Scenario, statusLabels } from "@/lib/contracts";
import { routeExplanation } from "./agent-showcase";
import { executionSteps } from "@/lib/investigation";

export default function ScenarioComparison({ cases, openCase, runScenario }: {
  cases: Case[]; openCase: (item: Case) => void; runScenario: (scenario: Scenario) => void;
}) {
  return <>
    <p className="comparison-intro">Compare the most recent local run of each fixture. Results come from actual runs; unrun scenarios do not have assumed outcomes. Running a scenario creates a new case.</p>
    <div className="comparison-grid">{scenarios.map(scenario => {
      const item = cases.filter(c => c.scenario === scenario.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return <article key={scenario.id} className="comparison-card"><h3>{scenario.title}</h3><p>{scenario.detail}</p>
        {item ? <><strong className="comparison-score">{item.score ?? "—"}<small>/100</small></strong><p><strong>{item.recommendation ? recommendations[item.recommendation] : "Not yet determined"}</strong><br />{statusLabels[item.status]}</p><p>{routeExplanation(item)}</p><p className="helper">Case {item.account} · {executionSteps(item).length} steps entered</p><Button variant="outlined" onClick={() => openCase(item)}>Open recorded run</Button></> : <><p><strong>Not run yet</strong></p><Button variant="outlined" onClick={() => runScenario(scenario.id)}>Try this scenario</Button></>}
      </article>;
    })}</div>
    <p className="helper">This comparison demonstrates conditional workflow behavior, not comparative detection accuracy. The sample corpus and scoring rules are illustrative.</p>
  </>;
}
