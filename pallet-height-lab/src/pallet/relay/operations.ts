import { hasBeltTransit } from './conveyor';
import type { Scenario } from '../types';
import type { RelayAction,RelayWorld } from './types';
export type ContextId='fixed'|'amr'|'cobot'|'mobile';
export const CONTEXTS={
 fixed:{name:'고정 셀 · 컨베이어',speed:650,payload:35,transportSpeed:800,dock:2,description:'고정 로봇 4대 · 각 셀 전용 반출 컨베이어'},
 amr:{name:'고정 로봇 + AMR',speed:650,payload:35,transportSpeed:600,dock:4,description:'고정 로봇 4대 · 셀별 AMR 1대 · 전용 직선 통로'},
 cobot:{name:'협동로봇 + AMR',speed:300,payload:15,transportSpeed:500,dock:4,description:'가상 협동로봇 4대 · 낮춘 TCP 속도·가반하중'},
 mobile:{name:'자율이동형 팔레트',speed:650,payload:35,transportSpeed:450,dock:3,description:'적재 중 도킹 고정 · 반출 시 팔레트 베이스 자체 이동'},
} as const;
export type ProcessPhase='ready'|'receiving'|'packing'|'checking'|'outbound'|'returning'|'complete';
export const PHASES:ProcessPhase[]=['receiving','packing','checking','outbound','returning'];
export const PHASE_LABELS:Record<ProcessPhase,string>={ready:'실행 준비',receiving:'박스 인입 · 계측',packing:'4대 배치 · 순환',checking:'완료 검사 · 출고 확정',outbound:'적재 팔레트 반출',returning:'빈 팔레트 복귀',complete:'배치 처리 완료'};
export const TRAVEL_MM=3000,SCAN_SECONDS=.35,INSPECT_SECONDS=3;
export function operationScenario(source:Scenario,context:ContextId,thickness:number){
 const s=structuredClone(source),preset=CONTEXTS[context];
 s.constraints.robotMode='gripper';
 Object.assign(s.constraints.gripper,{height:thickness,speed:preset.speed,payload:preset.payload});
 return s;
}
export function phaseSeconds(phase:ProcessPhase,total:number,context:ContextId){const c=CONTEXTS[context];return phase==='receiving'?Math.max(1,total*SCAN_SECONDS):phase==='checking'?INSPECT_SECONDS:phase==='outbound'||phase==='returning'?TRAVEL_MM/c.transportSpeed+c.dock:0;}
export function nextPhase(phase:ProcessPhase):ProcessPhase{return ({receiving:'packing',checking:'outbound',outbound:'returning',returning:'complete'} as Partial<Record<ProcessPhase,ProcessPhase>>)[phase]??phase;}
export function canRelease(world:RelayWorld,running:number,busy:boolean,decision: {actions:unknown[]}|null){return !hasBeltTransit(world)&&running===0&&!busy&&decision!==null&&decision.actions.length===0&&world.cells.some(c=>c.placements.length>0);}
export function manifest(world:RelayWorld){return world.cells.filter(c=>c.placements.length).map(c=>({robot:world.cells.indexOf(c)+1,boxIds:c.placements.map(p=>p.id),massKg:c.placements.reduce((n,p)=>n+p.weight,0),heightMm:Math.max(...c.placements.map(p=>p.position.z+p.size.h))}));}
export function actionTiming(action:RelayAction,scenario:Scenario){const g=scenario.constraints.gripper,handling=g.pickSeconds+g.placeSeconds;return {handling,motion:Math.max(0,action.seconds-handling),total:action.seconds};}
