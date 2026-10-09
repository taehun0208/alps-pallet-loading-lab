/** Raw-plan benchmark of an unchanged snapshot of the team's separate control-room engine. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults, makeManifest, currentBox, volume, top, SPEC, validateConfig as validateGeometryConfig } from '../docs/presentation/mcts/source/core.js';
import { TRANSPORT_DEFAULTS, physicalCheck } from '../docs/presentation/mcts/source/constraints.js';
import { plan, evaluatePlacement, candidates } from '../docs/presentation/mcts/source/search.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = resolve(ROOT, 'docs/presentation/mcts');
const sha = x => createHash('sha256').update(x).digest('hex');
const scriptSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
const snapshot = JSON.parse(readFileSync(resolve(DEST, 'provenance.json'), 'utf8'));
const POLICIES = [
  { id: 'greedy-8000', algorithm: 'greedy', budgetMs: 8000 },
  { id: 'beam-8000', algorithm: 'beam', budgetMs: 8000 },
  { id: 'mcts-100', algorithm: 'mcts', budgetMs: 100 },
  { id: 'mcts-1000', algorithm: 'mcts', budgetMs: 1000 },
  { id: 'mcts-8000', algorithm: 'mcts', budgetMs: 8000 },
];
const SEEDS = [2410, 2411, 2412, 2413, 2414];
const SCHEMA = 'control-room-single-pallet-mcts/1';
const LIMIT10 = 10000, LIMIT12 = 12000;
const now = () => performance.now();
const sum = (a, fn) => a.reduce((n, v) => n + fn(v), 0);
function verifySources() {
  for (const f of snapshot.files) if (sha(readFileSync(resolve(ROOT, f.copy))) !== f.sha256) throw Error(`Snapshot changed: ${f.copy}`);
  if (sha(readFileSync(fileURLToPath(import.meta.url))) !== scriptSha256) throw Error('Runner changed during execution');
}
function config(seed, quantity, p) {
  const c = defaults();
  Object.assign(c, { seed, algorithm: p.algorithm, budgetMs: p.budgetMs, policy: 'density', storeWeight: 0,
    planningSeed: 91473, lookaheadDepth: 3, beamWidth: 4, minSupport: .85, storeStrict: false,
    transportMode: 'unwrapped', transport: { ...TRANSPORT_DEFAULTS },
    pallets: [{ id: 0, cx: -.84, cz: 1.3, w: 1.2, d: 1, h: 1.2, maxKg: 700, name: 'Single fixed pallet', order: [0, 2, 1] }],
  });
  c.skus = c.skus.map(s => ({ ...s, a: quantity, b: 0 }));
  const error = validateGeometryConfig(c); if (error) throw Error(error);
  // The source UI validator caps search budgets at 2000ms. Raw plan itself supports
  // finite deadlines; this runner deliberately extends only the search allowance.
  if (!POLICIES.some(x => x.id === p.id && x.algorithm === p.algorithm && x.budgetMs === p.budgetMs)) throw Error('Unapproved algorithm/budget');
  return c;
}
function remaining(c, counts) {
  return c.skus.filter(s => counts[s.id] > 0).map(s => ({ ...s, id: s.id, sku: s.id, p: 0, count: counts[s.id] }));
}
function percentile(values, q) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), i = (a.length - 1) * q;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i - Math.floor(i));
}
function distribution(values) {
  const a = values.filter(Number.isFinite), n = a.length;
  if (!n) return { n: 0, mean: null, variance: null, std: null, min: null, max: null, p95: null, ci95: null };
  const mean = sum(a, v => v) / n, variance = n > 1 ? sum(a, v => (v - mean) ** 2) / (n - 1) : null, std = variance === null ? null : Math.sqrt(variance);
  const critical = n > 1 ? [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093][n - 2] : null;
  const half = critical && std !== null ? critical * std / Math.sqrt(n) : null;
  return { n, mean, variance, std, min: Math.min(...a), max: Math.max(...a), p95: percentile(a, .95), ci95: half === null ? null : [mean - half, mean + half] };
}
function measurements(placed, c) {
  const p = c.pallets[0], occupied = sum(placed, volume), usedHeight = Math.max(0, ...placed.map(top)), kg = sum(placed, b => b.kg);
  const cog = kg ? Object.fromEntries([['x', 'w'], ['y', 'h'], ['z', 'd']].map(([axis, len]) => [axis, sum(placed, b => b.kg * (b[axis] + b[len] / 2)) / kg])) : null;
  const xs = [...new Set([0, p.w, ...placed.flatMap(b => [b.x, b.x + b.w])])].sort((a,b) => a-b);
  const zs = [...new Set([0, p.d, ...placed.flatMap(b => [b.z, b.z + b.d])])].sort((a,b) => a-b);
  let belowSkyline = 0;
  for (let i=0;i<xs.length-1;i++) for (let j=0;j<zs.length-1;j++) {
    const x=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2;
    const height=Math.max(0,...placed.filter(b=>x>b.x-1e-10&&x<b.x+b.w+1e-10&&z>b.z-1e-10&&z<b.z+b.d+1e-10).map(top));
    belowSkyline+=(xs[i+1]-xs[i])*(zs[j+1]-zs[j])*height;
  }
  const allowed = p.w * p.d * p.h, envelope = p.w * p.d * usedHeight;
  return { placed: placed.length, massKg: kg, occupiedM3: occupied, allowedM3: allowed, utilization: occupied / allowed,
    usedHeightM: usedHeight, envelopeFill: envelope ? occupied/envelope : 0, allowedEmptyM3: allowed-occupied,
    envelopeEmptyM3: Math.max(0,envelope-occupied), columnGapM3: Math.max(0,belowSkyline-occupied),
    cog, cogHorizontalOffsetM: cog ? Math.hypot(cog.x-p.w/2,cog.z-p.d/2) : null, cogHeightM: cog?.y ?? null,
    cogEdgeMarginM: cog ? Math.min(cog.x,p.w-cog.x,cog.z,p.d-cog.z) : null,
  };
}
function finalProbe(placed, unplaced, c) {
  const out=[];
  for (const sku of c.skus) {
    const box=unplaced.find(b=>b.sku===sku.id); if(!box)continue;
    const counts=Object.fromEntries(c.skus.map(s=>[s.id,unplaced.filter(b=>b.sku===s.id).length])); counts[box.sku]--;
    const start=now(), result=candidates(box,c,placed,remaining(c,counts),{deadline:start+2000,limit:1,scan:480});
    out.push({sku:sku.id,box:box.id,examined:result.examined,ms:now()-start,cut:result.cut,reason:result.reason,hasSampledFit:result.items.length>0,placement:result.items[0]?.box??null});
  }
  return { budgetMsPerType:2000,scan:480,mutatesStack:false,typesWithSampledFit:out.filter(r=>r.hasSampledFit).length,typesWithCut:out.filter(r=>r.cut).length,rows:out };
}
function runTrial(seed, quantity, p, stage) {
  const startedAt=new Date().toISOString(), wall=now(), c=config(seed,quantity,p), manifest=makeManifest(c).map(item=>currentBox(item,c));
  const counts=Object.fromEntries(c.skus.map(s=>[s.id,quantity])), placed=[],unplaced=[], decisions=[],violations=[];
  const identityConfig=structuredClone(c); delete identityConfig.algorithm; delete identityConfig.budgetMs;
  const inputFingerprint=sha(JSON.stringify({identityConfig,manifest}));
  let pathSeconds=0;
  for(const box of manifest) {
    counts[box.sku]--;
    const begin=now(); let r, independent, reason='', error=null;
    try {
      // Only current observation, committed placements, SKU metadata and residual counts.
      // No manifest, next arrival or actual future order is passed to plan.
      const input=structuredClone({c,box,placed,remaining:remaining(c,counts)});
      r=plan(input);
      if(r.ok) {
        const b=r.best.box;
        const identity=b.id===box.id&&b.sku===box.sku&&b.p===0&&b.kg===box.kg&&Math.abs(volume(b)-volume(box))<1e-10;
        if(!identity) reason='Planner changed box identity or volume';
        else {independent=evaluatePlacement(b,c,placed,remaining(c,counts));if(!independent.ok)reason=independent.reason;}
      }
    } catch(e) {error=e instanceof Error?e.message:String(e);reason=error;}
    const decisionMs=now()-begin; // includes clone + planner + common acceptance recheck, not log serialization.
    const late10=decisionMs>LIMIT10,late12=decisionMs>LIMIT12;
    const accepted=!!r?.ok&&!!independent?.ok&&!reason&&!late10;
    if(reason)violations.push({box:box.id,reason});
    if(accepted){placed.push(structuredClone(r.best.box));pathSeconds+=independent.path.seconds;}
    else unplaced.push({...box,reason:reason||(late10?'10-second decision deadline exceeded':r?.reason||'No feasible sampled candidate')});
    decisions.push({index:decisions.length,box:box.id,sku:box.sku,remainingCounts:{...counts},accepted,reason:accepted?'':unplaced.at(-1).reason,
      ms:decisionMs,plannerMs:r?.ms??null,searchBudgetReached:!!r?.timedOut,overSearchBudget:decisionMs>p.budgetMs,
      late10,late12,search:r?.search??null,examined:r?.examined??0,rejections:r?.rejects??{},
      validInitialCandidates:r?.candidates?.length??0,placement:accepted?structuredClone(r.best.box):null,error});
  }
  const physical=physicalCheck(placed,c.pallets[0],c);
  if(!physical.ok)violations.push({box:'final-stack',reason:physical.reason});
  if(placed.length+unplaced.length!==manifest.length||new Set([...placed,...unplaced].map(b=>b.id)).size!==manifest.length)throw Error('Quantity conservation failed');
  const decisionTimes=decisions.map(d=>d.ms), planTimes=decisions.map(d=>d.plannerMs).filter(Number.isFinite);
  const timing={decision:distribution(decisionTimes),planner:distribution(planTimes),computeMs:sum(decisions,d=>d.ms),
    decisions:decisions.length,deadline10Misses:decisions.filter(d=>d.late10).length,deadline12Misses:decisions.filter(d=>d.late12).length,
    within10Rate:decisions.filter(d=>!d.late10).length/decisions.length,within12Rate:decisions.filter(d=>!d.late12).length/decisions.length,
    searchBudgetReached:decisions.filter(d=>d.searchBudgetReached).length,overSearchBudget:decisions.filter(d=>d.overSearchBudget).length,
    fallbackCalls:decisions.filter(d=>d.search?.fallback).length,fallbackRateAllDecisions:decisions.filter(d=>d.search?.fallback).length/decisions.length,
    simulations:sum(decisions,d=>d.search?.simulations??0),noFeasibleCandidateCalls:decisions.filter(d=>!d.validInitialCandidates).length};
  const probe=finalProbe(placed,unplaced,c);
  return {schema:SCHEMA,id:`${stage}:${seed}:${p.id}`,stage,seed,policy:p,quantityPerSku:quantity,startedAt,finishedAt:new Date().toISOString(),wallSeconds:(now()-wall)/1000,
    config:c,inputFingerprint,arrivals:manifest.map(b=>b.id),manifest,placements:placed,unplaced,unprocessed:[],decisions,violations,
    status:violations.length?'error':timing.deadline10Misses?'deadline_exceeded':'finished',
    eligible:!violations.length&&!timing.deadline10Misses,metrics:measurements(placed,c),timing,finalProbe:probe,
    finalPhysical:{ok:physical.ok,loadRatio:physical.loads?.maxRatio??null,transport:physical.transport?{ok:physical.transport.ok,minTip:physical.transport.minTip,minSlip:physical.transport.minSlip,globalMargin:physical.transport.globalMargin,certified:false}:null},
    pathEstimateSeconds:pathSeconds,robotOperationTarget:{primarySeconds:10,secondarySeconds:12,assumedMotion10:placed.length*10,assumedMotion12:placed.length*12,measuredRobotTime:false},
  };
}
const METRICS=['placed','utilization','usedHeightM','envelopeFill','allowedEmptyM3','envelopeEmptyM3','columnGapM3','cogHorizontalOffsetM','cogHeightM','cogEdgeMarginM','massKg'];
function aggregate(rows) {
  const summary=POLICIES.map(p=>{
    const rr=rows.filter(r=>r.policy.id===p.id),valid=rr.filter(r=>r.eligible);
    return {policy:p,n:rr.length,eligible:valid.length,failedSeeds:rr.filter(r=>!r.eligible).map(r=>r.seed),
      metrics:Object.fromEntries(METRICS.map(k=>[k,distribution(valid.map(r=>r.metrics[k]))])),
      timing:{meanDecisionMs:distribution(rr.map(r=>r.timing.decision.mean)),perOrderP95Ms:distribution(rr.map(r=>r.timing.decision.p95)),maxDecisionMs:Math.max(...rr.map(r=>r.timing.decision.max)),
        decisions:sum(rr,r=>r.timing.decisions),misses10:sum(rr,r=>r.timing.deadline10Misses),misses12:sum(rr,r=>r.timing.deadline12Misses),fallbackCalls:sum(rr,r=>r.timing.fallbackCalls),simulations:sum(rr,r=>r.timing.simulations)},
      finalProbe:{typesWithSampledFit:sum(rr,r=>r.finalProbe.typesWithSampledFit),runsWithSampledFit:rr.filter(r=>r.finalProbe.typesWithSampledFit).length,runsWithCutProbe:rr.filter(r=>r.finalProbe.typesWithCut).length}};
  });
  const paired=[];
  for(let i=0;i<POLICIES.length;i++)for(let j=i+1;j<POLICIES.length;j++) {
    const before=POLICIES[i].id,after=POLICIES[j].id,pairs=[];
    for(const seed of new Set(rows.map(r=>r.seed))) {
      const a=rows.find(r=>r.seed===seed&&r.policy.id===before),b=rows.find(r=>r.seed===seed&&r.policy.id===after);
      if(!a?.eligible||!b?.eligible||a.inputFingerprint!==b.inputFingerprint)continue;
      pairs.push({seed,difference:Object.fromEntries(METRICS.map(k=>[k,b.metrics[k]-a.metrics[k]]))});
    }
    paired.push({before,after,n:pairs.length,direction:'after minus before; fill/count higher is better, gaps/offset usually lower is better; no weighted overall score',metrics:Object.fromEntries(METRICS.map(k=>[k,distribution(pairs.map(p=>p.difference[k]))])),pairs});
  }
  return {summary,paired};
}
const assumptions=[
  'Unchanged source engine; one robot, one fixed pallet position, 1.2m maximum height, current observation plus known residual SKU counts, no actual future order supplied, no buffer or pallet exchange.',
  'Density policy removes store preference from the original score. Original planner heuristic, Beam width 4/depth 3, MCTS 3 sampled scenarios/depth 3/maximum 384 completed simulations are retained. Increasing time budget does not remove the 384-simulation ceiling.',
  'No heavy-first sorting or rule requiring heavy boxes below light boxes. Original support, upper load, static moment, unwrapped transport screening, suction, reach and sampled-link/path constraints remain common to every policy.',
  'Primary robot operation target is 10s, auxiliary 12s. An 8s search budget is a design assumption leaving 2s before 10s, not a measured hardware margin. 100ms and 1s arms are ablations of the same MCTS implementation.',
  'Measured decision time includes input cloning, raw plan and a common acceptance recheck. It excludes real sensing/network/controller/robot execution and result-file serialization. Calls exceeding 10s are not committed and make the run ineligible.',
  'Search budget checks are cooperative, not preemptive. A deadline reached can still return an incumbent. Fallback means no fully represented common scenario and selection of the initial valid root, not a fresh independent Greedy execution.',
  'Coordinates are metres, y vertical, x/z horizontal. Pallet local origin is the lower corner; world origin is robot base. Pallet center(-0.84,1.30), deck y=0.16, home(0,1.45,-0.9), pickup TCP(0,0.71+boxHeight,-1.23) are preserved. Suction tool envelope is 0.29×0.29×0.13m; approximate arm geometry/payload are retained.',
  'Source UI validates only 40–2000ms. This raw-plan runner deliberately extends budgets to 8000ms without altering planner source or physical constraints; it does not use the old sequential simulate/store/wrapping pipeline.',
  'Allowed empty volume, envelope empty volume, and column-gap volume are separate geometric proxies. Column-gap is empty volume under each occupied XY column top, not proof of an inaccessible cavity. Smaller CoG offset or height alone is not certified dynamic stability.',
  'Results are descriptive paired comparisons on five previously named seed values within this different engine, not a fresh holdout-selected universal winner. Do not rank them together with the existing capacity or 24-box store model; their algorithms, coordinates, constraints and arrival generator differ.',
];
function main() {
  const mode=process.argv[2];if(!['pilot','run'].includes(mode)||process.argv.length!==3)throw Error('Usage: node scripts/mcts-control-room-benchmark.mjs pilot|run');
  verifySources(); const stage=mode==='pilot'?'pilot':'evaluation',quantity=mode==='pilot'?1:12,seeds=mode==='pilot'?[9102]:SEEDS;
  const output=resolve(DEST,mode==='pilot'?'pilot.json':'results.json');
  if(existsSync(output)){console.log(JSON.stringify({cached:true,path:output}));return;}
  const startedAt=new Date().toISOString(),started=now(),rows=[],runDir=resolve(DEST,mode==='pilot'?'pilot-runs':'runs');mkdirSync(runDir,{recursive:true});
  const warmup=[];
  if(mode==='run')for(const p of [POLICIES[0],POLICIES[1],POLICIES[2]]){const r=runTrial(9202,1,p,'warmup');warmup.push({policy:p.id,seconds:r.wallSeconds,excluded:true});}
  for(const [i,seed] of seeds.entries())for(const p of [...POLICIES.slice(i%POLICIES.length),...POLICIES.slice(0,i%POLICIES.length)]){
    const rowPath=resolve(runDir,`${seed}-${p.id}.json`);let r;
    if(existsSync(rowPath)){r=JSON.parse(readFileSync(rowPath,'utf8'));if(r.provenance?.runnerSha256!==scriptSha256)throw Error(`Stale checkpoint preserved: ${rowPath}`);}
    else{r=runTrial(seed,quantity,p,stage);verifySources();r.provenance={runnerSha256:scriptSha256,sources:snapshot.files.map(f=>({copy:f.copy,sha256:f.sha256}))};writeFileSync(rowPath,JSON.stringify(r,null,2)+'\n',{flag:'wx'});}
    rows.push(r);console.log(JSON.stringify({done:rows.length,total:seeds.length*POLICIES.length,seed,policy:p.id,status:r.status,placed:r.metrics.placed,fill:r.metrics.utilization,maxDecisionMs:r.timing.decision.max,fallback:r.timing.fallbackCalls,seconds:r.wallSeconds}));
  }
  const result={schema:SCHEMA,stage,startedAt,finishedAt:new Date().toISOString(),wallSeconds:(now()-started)/1000,environment:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version},provenance:{runnerSha256:scriptSha256,snapshot},policies:POLICIES,seeds,quantityPerSku:quantity,totalBoxes:quantity*6,robotSpec:SPEC,warmup,assumptions,rows,...aggregate(rows)};
  verifySources();writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({saved:output,seconds:result.wallSeconds,summary:result.summary.map(s=>({policy:s.policy.id,fill:s.metrics.utilization.mean,placed:s.metrics.placed.mean,maxMs:s.timing.maxDecisionMs,fallback:s.timing.fallbackCalls}))}));
}
try{main();}catch(e){console.error(e instanceof Error?e.stack:String(e));process.exitCode=1;}
