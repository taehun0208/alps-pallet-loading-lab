import { scenario } from '../scenarios';
import { volume } from '../geometry';
import { CASES } from './model';
import { getAlgorithm } from './registry';
import type { BenchmarkConfig,CaseId } from './model';
import type { Scenario } from '../types';
export function buildCase(base:Scenario,caseId:CaseId,seed:number){
 const s=structuredClone(base);s.supplyMode='arrival';s.events=[];s.arrival={seed,pattern:'shuffle'};
 if(caseId==='identical'){s.types=structuredClone(scenario('identical').types);s.types[0].maxLoadKg=100;}
 if(caseId==='smallFirst')s.arrival.pattern='large-late';
 if(caseId==='largeFirst'){s.types.sort((a,b)=>volume(b.size)-volume(a.size));s.arrival.pattern='ordered';}
 if(caseId==='heavyLate'||caseId==='lightFirst')s.arrival.pattern='heavy-late';
 if(caseId==='random')s.arrival.pattern='random-draw';
 const eventStep=Math.min(3,s.types.reduce((n,t)=>n+t.quantity,0));
 if(caseId==='missing'||caseId==='damaged')s.events=[{step:eventStep,kind:caseId}];
 if(caseId==='resize'){const t=s.types.find(t=>t.quantity>0)!;s.events=[{step:eventStep,kind:'resize',size:{w:Math.round(t.size.w*1.12),d:Math.round(t.size.d*.93),h:t.size.h}}];}
 return s;
}
export function validateBenchmark(c:BenchmarkConfig){
 if(!Number.isInteger(c.warmupRuns??1)||(c.warmupRuns??1)<0||(c.warmupRuns??1)>5)throw Error('워밍업은 알고리즘별 0~5회입니다.');
 if(c.robotAccelerationMmS2!=null&&(!Number.isFinite(c.robotAccelerationMmS2)||c.robotAccelerationMmS2<=0))throw Error('TCP 가속도 가정은 양수 또는 미지정입니다.');
 if(!Number.isInteger(c.repeats)||c.repeats<1||c.repeats>1000)throw Error('반복 횟수는 1~1000회입니다.');
 if(!c.algorithms.length||new Set(c.algorithms).size!==c.algorithms.length)throw Error('중복 없이 알고리즘을 선택하세요.');c.algorithms.forEach(getAlgorithm);
 if(!c.cases.length||c.cases.some(v=>!(v in CASES))||new Set(c.cases).size!==c.cases.length)throw Error('시나리오 선택을 확인하세요.');
 if((c.algorithms.length+(c.includeOffline?1:0))*c.cases.length*c.repeats>10000)throw Error('한 실행은 10,000 trial 이하로 나누세요.');
 if(!Number.isInteger(c.seed)||c.seed<0||c.seed>2147483647||!Number.isFinite(c.decisionMs)||c.decisionMs<10||c.decisionMs>60000||!Number.isFinite(c.trialMs)||c.trialMs<c.decisionMs||c.trialMs>300000||!Number.isInteger(c.probeLimit)||c.probeLimit<0||c.probeLimit>64)throw Error('시드·시간 예산·잔량 검사 예산을 확인하세요.');
 if(c.repeats*c.cases.length*(c.algorithms.length+(c.includeOffline?1:0))*c.scenario.types.reduce((n,t)=>n+t.quantity,0)>250000)throw Error('단계 기록 메모리를 위해 한 실행은 최대 250,000 박스 시도로 나누세요.');
 if(!c.scenario.types.some(t=>t.quantity>0))throw Error('적재 대상 박스가 필요합니다.');
 if(c.algorithms.some(id=>getAlgorithm(id).scope!=='online'))throw Error('오프라인 기준해는 별도 옵션으로 실행합니다.');
}
