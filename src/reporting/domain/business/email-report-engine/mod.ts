/** Report engine adapter — re-exports from legacy lib/report-engine.ts.
 *  Same pattern as pipeline orchestrator — legacy code still exists and
 *  shares the same KV instance. */

export { queryReportData, runReport, resolveDateRange, evaluateRules } from "../../../../../lib/report-engine.ts";
export { renderSections, renderFullEmail } from "../../../../../lib/report-renderer.ts";
