import type { Candidate, Observation, Placement, PlanningInput, Scenario } from './vendor/pallet/types';
export type { Candidate, Observation, Placement, PlanningInput, Scenario } from './vendor/pallet/types';

export type AlgorithmId = 'blb' | 'capacity-compact' | 'strategy-greedy' | 'lookahead' | 'future-hybrid' | 'mcts' | 'floor-dense' | 'cluster-floor' | 'cluster-layer' | 'dispersed';
export interface SimulationConfig {
  cycleSeconds: 10 | 12;
  recognitionDelaySeconds: number;
  reserveSeconds: number;
  maxHeightMm: number;
  quantityPerSku: number;
  /** null: use the full available window; a smaller number is an explicit ablation. */
  searchBudgetMs: number | null;
  maxCandidates: number;
  mcts: { depth: number; scenarios: number; maxIterations: number };
}
export interface ExperimentRequest { config: SimulationConfig; algorithms: AlgorithmId[]; seeds: number[] }
export type FallbackReason = 'none' | 'watchdog' | 'search_budget' | 'insufficient_scenarios' | 'no_valid_candidate' | 'planner_error' | 'cancelled';
export interface DecisionRequest {
  id: string; algorithm: AlgorithmId; input: PlanningInput;
  availableMs: number; searchBudgetMs: number; mcts: SimulationConfig['mcts'];
}
export interface DecisionOutcome {
  candidate: Candidate | null;
  strategyState?: PlanningInput['strategyState'];
  planningMs: number; elapsedMs: number; fallback: boolean; fallbackReason: FallbackReason;
  validDeadline: boolean; watchdog: boolean;
  simulations: number; completeScenarios: number; message: string;
  searchDiagnostics?: Record<string, string | number | number[]>;
}
export type PlanDecision = (request: DecisionRequest, signal?: AbortSignal) => Promise<DecisionOutcome>;
export interface DecisionTrace {
  index: number; box: Observation; accepted: boolean; reason: string; placement?: Placement;
  recognitionMs: number; planningMs: number; decisionMs: number; validationMs: number;
  availableMs: number; searchBudgetMs: number; fallback: boolean; fallbackReason: FallbackReason;
  validDeadline: boolean; watchdog: boolean; simulations: number; completeScenarios: number;
  searchDiagnostics?: Record<string, string | number | number[]>;
  remaining: Record<string, number>;
  timing: { start: number; end: number; robotStart: number | null; robotEnd: number | null; exposedWaitSeconds: number; overlappedPlanningSeconds: number };
}
export interface TrialMetrics {
  count: number; total: number; fill: number; volumeMm3: number; usedHeightMm: number;
  floorContactAreaMm2?: number; floorCoverage?: number; projectedFootprintAreaMm2?: number; projectedFootprintCoverage?: number;
  envelopeFill: number; allowedEmptyMm3: number; envelopeEmptyMm3: number; columnVoidMm3: number;
  massKg: number; center: { x: number; y: number; z: number };
  cogHorizontalOffsetMm: number; cogHeightMm: number;
  minSupportRatio: number | null; maxLoadRatio: number | null;
  computeMs: number; meanDecisionMs: number | null; p95DecisionMs: number | null; maxDecisionMs: number | null;
  deadlineMisses: number; fallbackCount: number; robotSeconds: number; planningWaitSeconds: number; totalSeconds: number;
  storeProxy: { crossZoneBlockers: number; label: string; measuredSeconds: null };
}
export interface TrialResult {
  id: string; algorithm: AlgorithmId; seed: number; config: SimulationConfig; scenario: Scenario;
  status: 'finished' | 'cancelled' | 'error'; reason: string;
  arrivals: Observation[]; placements: Placement[]; unplaced: Observation[]; unprocessed: Observation[];
  decisions: DecisionTrace[]; violations: string[]; metrics: TrialMetrics;
  sourceVersion: string; inputFingerprint: string;
}
export interface Progress {
  algorithm: AlgorithmId; seed: number; completedTrials: number; totalTrials: number;
  processed: number; totalBoxes: number; placements: Placement[]; decision: DecisionTrace | null;
}
export interface ExperimentResult { config: SimulationConfig; algorithms: AlgorithmId[]; seeds: number[]; rows: TrialResult[]; cancelled: boolean; assumptions: string[] }
export interface RunOptions { planDecision: PlanDecision; signal?: AbortSignal; onProgress?: (p: Progress) => void; /** Benchmark-only workload; cloned before use, hidden arrival order never enters planning. */ scenario?: Scenario }
export type EngineCommand = { type: 'start'; runId: string; request: ExperimentRequest } | { type: 'cancel'; runId: string };
export type EngineEvent =
  | { type: 'progress'; runId: string; progress: Progress }
  | { type: 'trial'; runId: string; row: TrialResult }
  | { type: 'result'; runId: string; result: ExperimentResult }
  | { type: 'error'; runId: string; message: string };
export type PlannerCommand = { type: 'plan'; request: DecisionRequest };
export type PlannerEvent =
  | { type: 'ready' }
  | { type: 'incumbent'; id: string; candidate: Candidate; planningMs: number }
  | { type: 'result'; id: string; outcome: DecisionOutcome }
  | { type: 'error'; id: string; message: string };
