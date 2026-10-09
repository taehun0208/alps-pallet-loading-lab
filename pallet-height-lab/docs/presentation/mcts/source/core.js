export const SPEC = { reach: 2.75, payload: 50, suction: 30, shoulderY: .64, upper: 1.25, fore: 1.5, tool: .16 };
export const ZONES = ['식품', '생활', '뷰티'];
export const COLORS = ['#c58c56', '#68a396', '#869dc5'];
export const EPS = 1e-5;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const dist = (a, b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
export const lerp = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
export const clone = x => structuredClone(x);
export function rng(seed) { let n=seed>>>0; return ()=> { n+=0x6D2B79F5; let t=n; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
export function defaults() {
  return { seed:42, industry:'market', policy:'balanced', storeWeight:30, minSupport:.75, toolMass:8, speed:.65, acceleration:.8, pickTime:.7, releaseTime:.45, budgetMs:240,
    pallets:[{id:0,name:'매장 A',cx:-.94,cz:1.19,w:1.2,d:1,h:1.45,maxKg:700,order:[0,1,2]}, {id:1,name:'매장 B',cx:.94,cz:1.19,w:1.2,d:1,h:1.45,maxKg:700,order:[2,0,1]}],
    skus:[
      {id:'S1',name:'생수',w:.4,d:.3,h:.28,kg:12,topKg:85,zone:0,a:3,b:3},
      {id:'S2',name:'과자',w:.5,d:.34,h:.25,kg:3,topKg:24,zone:0,a:3,b:3},
      {id:'S3',name:'세제',w:.32,d:.24,h:.32,kg:8,topKg:55,zone:1,a:3,b:3},
      {id:'S4',name:'생활용품',w:.4,d:.3,h:.22,kg:4,topKg:40,zone:1,a:3,b:3},
      {id:'S5',name:'헤어케어',w:.3,d:.25,h:.24,kg:6,topKg:45,zone:2,a:3,b:3},
      {id:'S6',name:'스킨케어',w:.25,d:.2,h:.2,kg:4,topKg:30,zone:2,a:3,b:3},
    ]};
}
export function preset(name, config) {
  const c=clone(config); c.industry=name;
  const names=name==='beauty'?['클렌징','스킨케어','헤어케어','바디케어','메이크업','뷰티도구']:name==='home'?['주방용품','수납용품','욕실용품','청소용품','문구','시즌상품']:['생수','과자','세제','생활용품','헤어케어','스킨케어'];
  c.skus.forEach((s,i)=>{s.name=names[i]; if(name==='beauty'){s.w=[.32,.3,.4,.36,.28,.3][i];s.d=[.24,.24,.3,.25,.2,.22][i];s.h=[.22,.2,.28,.24,.2,.25][i];s.kg=[5,4,8,7,3,3][i];}else{Object.assign(s,defaults().skus[i],{name:names[i]});}});
  return c;
}
export function makeManifest(c) {
  const rand=rng(c.seed), list=[]; let id=1;
  c.skus.forEach(s=>{[s.a,s.b].forEach((qty,p)=>{for(let i=0;i<qty;i++)list.push({id:'B'+String(id++).padStart(3,'0'),sku:s.id,p,status:'pending'});});});
  for(let i=list.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
  return list;
}
export function currentBox(item,c){return {...clone(c.skus.find(s=>s.id===item.sku)),...item};}
export function remainingInfo(list,c,excludeId) {
  return c.skus.flatMap(s=>[0,1].map(p=>({...clone(s),p,count:list.filter(b=>b.status==='pending'&&b.id!==excludeId&&b.sku===s.id&&b.p===p).length}))).filter(s=>s.count>0);
}
export const top = b => b.y+b.h;
export const volume = b => b.w*b.d*b.h;
export function overlap1(a,w,b,v){return Math.max(0,Math.min(a+w,b+v)-Math.max(a,b));}
export function overlap(a,b,margin=0){return a.x<b.x+b.w-margin&&a.x+a.w>b.x+margin&&a.z<b.z+b.d-margin&&a.z+a.d>b.z+margin&&a.y<b.y+b.h-margin&&a.y+a.h>b.y+margin;}
export function worldBox(b,p){return {...b,x:p.cx-p.w/2+b.x,z:p.cz-p.d/2+b.z,y:.16+b.y};}
export function hull(points) {
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],hi=[]; for(const p of sorted){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}
  for(const p of sorted.slice().reverse()){while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}
  lo.pop();hi.pop();return lo.concat(hi);
}
export function insidePolygon(x,z,poly) {
  if(poly.length<3)return false;
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]) < -EPS)return false;}return true;
}
export function supportOf(b,placed) {
  if(b.y<EPS)return {ratio:1,contacts:[],center:true};
  let area=0;const contacts=[],corners=[];
  for(const q of placed){if(Math.abs(top(q)-b.y)>.001)continue;const w=overlap1(b.x,b.w,q.x,q.w),d=overlap1(b.z,b.d,q.z,q.d);if(w*d<EPS)continue;
    const x=Math.max(b.x,q.x),z=Math.max(b.z,q.z);area+=w*d;contacts.push({id:q.id,area:w*d});corners.push([x,z],[x+w,z],[x+w,z+d],[x,z+d]);}
  return {ratio:area/(b.w*b.d),contacts:contacts.map(q=>({...q,share:q.area/area})),center:insidePolygon(b.x+b.w/2,b.z+b.d/2,hull(corners))};
}
export function loadReport(boxes) {
  const loads=Object.fromEntries(boxes.map(b=>[b.id,0]));let maxRatio=0;const unknown=[];
  for(const b of [...boxes].sort((a,b)=>b.y-a.y)){
    const load=loads[b.id]||0;
    if(b.topKg==null)unknown.push(b.id);else{maxRatio=Math.max(maxRatio,load/Math.max(.01,b.topKg));if(load>b.topKg+EPS)return {ok:false,reason:`${b.name} 상부하중 ${load.toFixed(1)} / ${b.topKg}kg`,loads,maxRatio,unknown};}
    const s=supportOf(b,boxes.filter(q=>q.id!==b.id));for(const q of s.contacts)loads[q.id]+=(b.kg+load)*q.share;
  }return {ok:true,loads,maxRatio,unknown};
}
export function coordinates(boxes,p,w,d) {
  const xs=new Set([0,p.w-w,p.w/3-w/2,p.w*2/3-w/2]),zs=new Set([0,p.d-d]);
  for(const q of boxes){[q.x,q.x+q.w,q.x-w,q.x+q.w-w].forEach(v=>xs.add(v));[q.z,q.z+q.d,q.z-d,q.z+q.d-d].forEach(v=>zs.add(v));}
  return {xs:[...xs].filter(x=>x>=-EPS&&x+w<=p.w+EPS),zs:[...zs].filter(z=>z>=-EPS&&z+d<=p.d+EPS),ys:[...new Set([0,...boxes.map(top)])].sort((a,b)=>a-b)};
}
export function geometryOK(b,boxes,p,c){if(b.x< -EPS||b.z< -EPS||b.x+b.w>p.w+EPS||b.z+b.d>p.d+EPS||top(b)>p.h+EPS)return false;if(boxes.some(q=>overlap(b,q,EPS)))return false;const s=supportOf(b,boxes);return s.ratio+EPS>=c.minSupport&&s.center;}
export function ik(tcp) {
  const wrist={x:tcp.x,y:tcp.y+SPEC.tool,z:tcp.z};const r=Math.hypot(wrist.x,wrist.z),dy=wrist.y-SPEC.shoulderY,reach=Math.hypot(r,dy);
  if(reach>SPEC.upper+SPEC.fore-.015||reach<.38||tcp.y<.18)return null;
  const a=Math.acos(clamp((SPEC.upper**2+reach**2-SPEC.fore**2)/(2*SPEC.upper*reach),-1,1));const pitch=Math.atan2(dy,r)+a;
  const dir=r>EPS?{x:wrist.x/r,z:wrist.z/r}:{x:0,z:1};
  const shoulder={x:0,y:SPEC.shoulderY,z:0},elbow={x:Math.cos(pitch)*SPEC.upper*dir.x,y:SPEC.shoulderY+Math.sin(pitch)*SPEC.upper,z:Math.cos(pitch)*SPEC.upper*dir.z};
  if(elbow.y<.25)return null;
  return {shoulder,elbow,wrist,tcp,yaw:Math.atan2(tcp.x,tcp.z),pitch,elbowAngle:Math.acos(clamp((SPEC.upper**2+SPEC.fore**2-reach**2)/(2*SPEC.upper*SPEC.fore),-1,1))};
}
function segmentAABB(a,b,box,radius=0){
  let lo=0,hi=1;for(const [key,len] of [['x','w'],['y','h'],['z','d']]){const v=b[key]-a[key],min=box[key]-radius,max=box[key]+box[len]+radius;if(Math.abs(v)<1e-10){if(a[key]<min||a[key]>max)return false;}else{let t1=(min-a[key])/v,t2=(max-a[key])/v;if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return false;}}return true;
}
export const home = () => ({x:0,y:1.45,z:-.9});
export const pickup = b => ({x:0,y:.71+b.h,z:-1.23});
function travelSeconds(length,c){const v=c.speed,a=c.acceleration;return length<v*v/a?2*Math.sqrt(length/a):length/v+v/a;}
export function pathFor(b,p,allPlaced,c) {
  const targetWorld=worldBox(b,p),start=pickup(b),end={x:targetWorld.x+b.w/2,y:targetWorld.y+b.h,z:targetWorld.z+b.d/2};
  const world=allPlaced.map(q=>worldBox(q,c.pallets[q.p]));
  const highest=Math.max(.71,...world.map(q=>top(q)));const lift=Math.max(start.y,end.y,highest+b.h+.14);
  // A common overhead transfer keeps carried goods clear of the existing stack.
  const points=[home(),{...start,y:lift},start,{...start,y:lift},{x:end.x,y:lift,z:end.z},end,{...end,y:lift},home()];
  const stages=['접근','흡착 접근','들어 올리기','매장으로 이동','내려놓기','흡착 해제·이탈','복귀'];
  let length=0,seconds=c.pickTime+c.releaseTime;const segments=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],z=points[i+1],carrying=i>=2&&i<=4;const l=dist(a,z),duration=Math.max(.08,travelSeconds(l,c));length+=l;seconds+=duration;
    const n=Math.max(2,Math.ceil(l/.095));
    for(let k=0;k<=n;k++){
      const t=lerp(a,z,k/n),pose=ik(t);if(!pose)return {ok:false,reason:'도달 범위: 상부 이동·접근 자세',points};
      const angle=b.turn?(i===2?k/n*Math.PI/2:i>2?Math.PI/2:0):0,sw=b.sourceW??b.w,sd=b.sourceD??b.d;
      const cw=Math.abs(Math.cos(angle))*sw+Math.abs(Math.sin(angle))*sd,cd=Math.abs(Math.sin(angle))*sw+Math.abs(Math.cos(angle))*sd;
      const carried={x:t.x-cw/2,y:t.y-b.h,z:t.z-cd/2,w:cw,h:b.h,d:cd};
      const tool={x:t.x-.145,y:t.y+.006,z:t.z-.145,w:.29,h:.13,d:.29};
      for(const obstacle of world){
        if(carrying&&overlap(carried,obstacle,.002))return {ok:false,reason:'운반 박스의 이동 경로 충돌',points};
        if(overlap(tool,obstacle,.002))return {ok:false,reason:'흡착기 접근·이탈 공간 부족',points};
        if(segmentAABB(pose.shoulder,pose.elbow,obstacle,.09)||segmentAABB(pose.elbow,pose.wrist,obstacle,.075))return {ok:false,reason:'로봇 링크의 근사 충돌',points};
      }
      // After release the newly placed box is also an obstacle.
      if(i>=5&&(overlap(tool,targetWorld,.002)||segmentAABB(pose.elbow,pose.wrist,targetWorld,.06)))return {ok:false,reason:'배치 후 그리퍼·링크 이탈 불가',points};
    }
    segments.push({a,b:z,seconds:duration,carrying,stage:stages[i],index:i});
  }
  // The display uses the same segmented trajectory as the planner.
  segments.splice(2,0,{a:start,b:start,seconds:c.pickTime,carrying:true,stage:'진공 흡착',index:1.5});
  segments.splice(6,0,{a:end,b:end,seconds:c.releaseTime,carrying:true,stage:'놓기·진공 해제',index:4.5});
  return {ok:true,points,segments,length,seconds,end,check:'샘플 경로·링크 체적 근사'};
}
export function unloading(boxes,p) {
  const rank=z=>p.order.indexOf(z);const active=new Map(boxes.map(b=>[b.id,b]));const temp=new Set();let moves=0;
  function blockers(b){return [...active.values()].filter(q=>q.id!==b.id&&((q.y>=top(b)-EPS&&overlap1(q.x,q.w,b.x,b.w)>EPS&&overlap1(q.z,q.d,b.z,b.d)>EPS)||(q.z+q.d<=b.z+EPS&&overlap1(q.x,q.w,b.x,b.w)>EPS&&overlap1(q.y,q.h,b.y,b.h)>EPS)));}
  function remove(b,targetRank,seen=new Set()){
    if(!active.has(b.id)||seen.has(b.id))return;seen.add(b.id);
    for(const q of blockers(b))remove(q,targetRank,seen);
    if(rank(b.zone)>targetRank)temp.add(b.id);active.delete(b.id);moves++;
  }
  for(const b of [...boxes].sort((a,b)=>rank(a.zone)-rank(b.zone)||b.y-a.y||a.z-b.z))remove(b,rank(b.zone));
  return {rehandles:temp.size,moves,ids:[...temp]};
}
export function metrics(placed,c) {
  const pallets=c.pallets.map(p=>{const bs=placed.filter(b=>b.p===p.id),kg=bs.reduce((a,b)=>a+b.kg,0),h=Math.max(0,...bs.map(top)),vol=bs.reduce((a,b)=>a+volume(b),0);const cog=kg?{x:bs.reduce((s,b)=>s+b.kg*(b.x+b.w/2),0)/kg,y:bs.reduce((s,b)=>s+b.kg*(b.y+b.h/2),0)/kg,z:bs.reduce((s,b)=>s+b.kg*(b.z+b.d/2),0)/kg}:null;
    return {id:p.id,count:bs.length,kg,height:h,fill:h?vol/(p.w*p.d*h):0,capacity:vol/(p.w*p.d*p.h),cog,loads:loadReport(bs),rehandles:unloading(bs,p).rehandles};});
  return {pallets,total:placed.length,rehandles:pallets.reduce((s,p)=>s+p.rehandles,0),volume:placed.reduce((s,b)=>s+volume(b),0)};
}
export function validateConfig(c,placed=[]) {
  if([c.seed,c.toolMass,c.speed,c.acceleration,c.minSupport,c.budgetMs,c.storeWeight].some(v=>!Number.isFinite(v)))return '작업 조건의 숫자 입력을 확인해 주세요.';
  if(!Number.isFinite(c.seed)||c.seed<0)return '시드는 0 이상의 숫자로 입력해 주세요.';
  if(c.toolMass<0||c.toolMass>=50)return '도구 무게는 0 이상 50kg 미만이어야 합니다.';
  if(c.speed<.05||c.speed>2||c.acceleration<=0)return '이동 속도 범위를 확인해 주세요.';
  if(c.minSupport<.5||c.minSupport>1)return '최소 지지율은 50~100% 범위입니다.';
  let count=0;
  for(const s of c.skus){if([s.w,s.d,s.h,s.kg,s.topKg,s.a,s.b].some(v=>!Number.isFinite(v)))return '상품 정보에 숫자가 아닌 값이 있습니다.';if(Math.min(s.w,s.d,s.h)<.1||Math.max(s.w,s.d,s.h)>1.2)return '박스 크기는 100~1200mm 범위로 입력해 주세요.';if(s.kg<=0||s.topKg<0)return '박스 중량은 양수, 허용 상부하중은 0 이상이어야 합니다.';if(!Number.isInteger(s.a)||!Number.isInteger(s.b)||s.a<0||s.b<0)return '수량은 0 이상의 정수입니다.';count+=s.a+s.b;}
  if(count>180)return '화면 시뮬레이션은 주문당 최대 180개입니다.';
  for(const p of c.pallets){if([p.w,p.d,p.h,p.maxKg].some(v=>!Number.isFinite(v)))return '팔레트 규격을 확인해 주세요.';if(p.w<.7||p.w>1.5||p.d<.7||p.d>1.3||p.h<.4||p.h>1.8)return '팔레트 폭 700~1500, 깊이 700~1300, 적재 높이 400~1800mm 범위입니다.';
    const bs=placed.filter(b=>b.p===p.id);if(bs.some(b=>b.x< -EPS||b.z< -EPS||b.x+b.w>p.w+EPS||b.z+b.d>p.d+EPS||top(b)>p.h+EPS))return `${p.name}: 새 규격 밖으로 기존 적재물이 돌출됩니다. 새 주문으로 시작해 주세요.`;if(p.maxKg<=0||bs.reduce((a,b)=>a+b.kg,0)>p.maxKg)return `${p.name}: 총중량 한도를 확인해 주세요.`;
    if(bs.some(b=>supportOf(b,bs.filter(q=>q.id!==b.id)).ratio+EPS<c.minSupport))return `${p.name}: 기존 적재물이 새 최소 지지율을 만족하지 않습니다. 새 주문에서 적용해 주세요.`;
  }
  return null;
}
