import { expect } from "@playwright/test";
import { caseSchema } from "../src/lib/contracts";
import { executionSteps } from "../src/lib/investigation";

export function assertRecordedRoute(payload: unknown, goldenRoute: string[]) {
  const item = caseSchema.parse(payload);
  const route = executionSteps(item).map(step => step.start.node);
  expect(route.filter(node => node !== "investigator")).toEqual(goldenRoute);
  const investigatorSteps = route.filter(node => node === "investigator");
  expect(investigatorSteps).toHaveLength(item.investigator ? 1 : 0);
  return route;
}
