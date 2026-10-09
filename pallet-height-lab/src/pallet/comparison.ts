import { STRATEGY_IDS } from './strategies/PackingStrategy';
import { LEGACY_ALGORITHMS } from './types';
import type { Algorithm,Scenario } from './types';
// A shared inventory prevents the worker and rendered/exported comparisons from diverging.
export function comparisonAlgorithms(s:Pick<Scenario,'supplyMode'>):readonly Algorithm[]{
 return [...(s.supplyMode==='stock-select'?LEGACY_ALGORITHMS:STRATEGY_IDS),'random'];
}
