import type { RelayMotion,RelayWorld } from './types';

export const HISTORY_LIMIT=600;
export interface StreamFrame {
 world:RelayWorld;motions:RelayMotion[];peak:number;ms:number;checks:number;
 event?:'initial'|'state'|'decision';decisionMilliseconds?:number;
}
export interface StreamSnapshot extends StreamFrame {busy:boolean;history:StreamFrame[];latencySamples:number[]}

/** Worlds and motion objects are immutable engine snapshots. Keep references instead of
 * duplicating the full scene at animation frequency; callers must not mutate past frames.
 */
export function initializeStreamHistory(world:RelayWorld):StreamSnapshot {
 const frame:StreamFrame={world,motions:[],peak:0,ms:0,checks:0,event:'initial'};
 return {...frame,busy:false,history:[frame],latencySamples:[]};
}
const assignmentSignature=(w:RelayWorld)=>JSON.stringify(w.stream?.orchestration?.assignments.map(a=>[a.boxId,a.robot,a.launchNow]));

/** Capture revisions or changed dispatch intentions. Force a decision event for each
 * evaluated planner response even if assignments stay unchanged, preserving latency drilldown.
 * Simulation time and motion elapsed values stay exactly as they were at the event.
 */
export function captureStreamHistory(snapshot:StreamSnapshot,forceDecision=false):StreamSnapshot {
 const prior=snapshot.history.at(-1);
 if(!forceDecision&&prior&&prior.world.runId===snapshot.world.runId&&prior.world.revision===snapshot.world.revision&&assignmentSignature(prior.world)===assignmentSignature(snapshot.world))return snapshot;
 const frame:StreamFrame={world:snapshot.world,motions:snapshot.motions,peak:snapshot.peak,ms:snapshot.ms,checks:snapshot.checks,
  event:forceDecision?'decision':'state',...(forceDecision?{decisionMilliseconds:snapshot.ms}:{})};
 const history=prior&&prior.world.runId!==snapshot.world.runId?[]:snapshot.history;
 return {...snapshot,history:[...history.slice(-(HISTORY_LIMIT-1)),frame]};
}
