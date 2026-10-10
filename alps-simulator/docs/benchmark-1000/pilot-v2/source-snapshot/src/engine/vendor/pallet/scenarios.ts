import { validateSpec,permittedOrientations } from './packaging/spec';
import { ALL_ORIENTATIONS } from './orientations';
import { heterogeneousInventory,DEFAULT_FIELD } from './inventoryGeneration';
import { highStackBoxes } from './highStack';
import type { Scenario, Dimensions } from './types';
import { DEFAULT_STABILITY } from './types';
import { DEFAULT_STANDING_HEIGHT } from './standingHeight';
export function scenario(id='mixed',seed=42):Scenario {
 const s:Scenario={version:1,units:{length:'mm',weight:'kg',time:'s'},id,name:'혼합 박스 · 기본 예제',pallet:{width:1200,depth:1000,maxHeight:1600},types:[
 {id:'A',name:'대형',size:{w:600,d:400,h:300},weight:12,quantity:8,orientations:[0,90],color:'#e8b86a'},
 {id:'B',name:'중형',size:{w:400,d:300,h:250},weight:7,quantity:12,orientations:[0,90],color:'#6bcab7'},
 {id:'C',name:'소형',size:{w:300,d:200,h:200},weight:3,quantity:16,orientations:[0,90],color:'#80a9e8'},
 {id:'D',name:'미니',size:{w:200,d:200,h:150},weight:1.5,quantity:20,orientations:[0,90],color:'#cc97df'}],constraints:{robotMode:'ideal',supportRatio:.95,contactTolerance:.5,horizontalGap:0,heavyRule:'off',stability:{...DEFAULT_STABILITY},gripper:{width:180,depth:160,height:160,mass:3,payload:20,margin:5,lift:200,speed:650,pickSeconds:1,placeSeconds:1},workspace:{xMin:-1400,xMax:1600,yMin:-500,yMax:1500,zMax:2600}},arrival:{seed,pattern:'shuffle'},events:[]};
 s.types.forEach((t,i)=>{t.material=i<2?'plastic':'paper';t.strengthFactor=1;});
 if(id==='field'){s.supplyMode='stock-select';const input=heterogeneousInventory(DEFAULT_FIELD);s.name='서로 다른 혼합 박스 30개 · 합성 입력';s.types=input.types;s.generation=input.generation;s.arrival.pattern='random-draw';}
 if(id==='online-task'||id==='high-stack'||id==='compact-mixed'||id==='spatial-mixed'){s.supplyMode='arrival';const input=heterogeneousInventory(DEFAULT_FIELD);s.name='과제 조건 · 무작위 혼합 박스 30개';s.types=input.types;s.generation=input.generation;s.arrival.pattern='random-draw';s.constraints.robotMode='gripper';s.constraints.heavyRule='each';s.constraints.gripper.payload=35;s.constraints.gripper.rotationSpeed=180;s.constraints.reach={baseX:-700,baseY:500,minRadius:0,maxRadius:2400};s.constraints.stability!.slendernessMode='score';}
 if(id==='compact-mixed'){const input=heterogeneousInventory({...DEFAULT_FIELD,assortment:'repeated',typeCount:8,totalCount:48});s.name='혼합 공간 채우기 · 무작위 8종 48개';s.supplyMode='stock-select';s.types=input.types;s.generation=input.generation;}
 if(id==='spatial-mixed'){s.name='내부 빈틈 · 6자세 혼합 재고 30개';s.supplyMode='stock-select';s.types.forEach(t=>{if(t.handling!=='upright')t.orientations=[...ALL_ORIENTATIONS];});}
 if(id==='high-stack'){s.name='이전 검증 · 중앙 기둥 24개 · 6단';s.supplyMode='stock-select';s.types=highStackBoxes();delete s.generation;}
 if(id==='reference'){s.name='검증용 · 규격 박스 30개';s.types=[{...s.types[0],size:{w:600,d:400,h:200},weight:5.76,quantity:3},{...s.types[1],size:{w:400,d:400,h:200},weight:3.84,quantity:5},{...s.types[2],size:{w:400,d:200,h:200},weight:1.92,quantity:10},{...s.types[3],size:{w:200,d:200,h:200},weight:.96,quantity:12}];}
 if(id==='identical'){s.name='동일 박스 · 모두 적재 가능';s.types=[{...s.types[0],size:{w:300,d:250,h:200},weight:5,quantity:12}];}
 if(id==='large-late'){s.name='큰 박스가 늦게 도착';s.arrival.pattern='large-late';}
 if(id==='heavy-late'){s.name='무거운 박스가 늦게 도착';s.arrival.pattern='heavy-late';}
 if(id==='restricted'){s.name='회전 제한';s.types.forEach(t=>t.orientations=[0]);}
 if(id==='gripper'){s.name='그리퍼 접근 난이도';s.constraints.robotMode='gripper';s.constraints.gripper.width=650;s.constraints.gripper.depth=500;s.constraints.gripper.margin=20;}
 if(id==='events'){s.name='손상 · 누락 · 규격 변경';s.events=[{step:2,kind:'damaged'},{step:5,kind:'missing'},{step:8,kind:'resize',size:{w:500,d:350,h:320}}];}
 if(id==='impossible'){s.name='버퍼 없는 배치 실패';s.pallet={width:300,depth:300,maxHeight:300};s.types=[{...s.types[3],quantity:1},{...s.types[0],quantity:1,size:{w:400,d:400,h:200}}];s.arrival.pattern='ordered';}
 if(id==='materials'){s.name='가벼운 플라스틱 받침 · 무거운 종이 상자';s.types=[{...s.types[0],id:'P',name:'플라스틱 받침',size:{w:600,d:400,h:200},weight:3,quantity:4,material:'plastic'},{...s.types[2],id:'K',name:'종이 상자',size:{w:300,d:200,h:200},weight:7,quantity:12,material:'paper'}];s.arrival.pattern='ordered';}
 if(id==='buffer-demo'){s.name='임시 보류 → 받침 적재 → 상단 복귀';s.supplyMode='stock-select';s.pallet={width:400,depth:400,maxHeight:600};s.constraints.heavyRule='each';s.constraints.robotMode='gripper';s.types=[
  {id:'CAP',name:'위 적재 금지 · 마지막 상자',size:{w:400,d:400,h:100},weight:1,quantity:1,orientations:[0],handling:'no-top-load',material:'paper',maxLoadKg:0,color:'#cc97df'},
  {id:'BASE',name:'튼튼한 하단',size:{w:400,d:400,h:200},weight:10,quantity:1,orientations:[0],material:'plastic',maxLoadKg:100,color:'#6bcab7'},
  {id:'MID',name:'중간 받침',size:{w:400,d:400,h:150},weight:5,quantity:1,orientations:[0],material:'plastic',maxLoadKg:60,color:'#e8b86a'}];}
 s.constraints.standingHeight={...DEFAULT_STANDING_HEIGHT};
 return s;
}
export const SCENARIOS=['online-task','buffer-demo','spatial-mixed','compact-mixed','high-stack','field','reference','mixed','identical','materials','large-late','heavy-late','restricted','gripper','events','impossible'].map(id=>({id,name:id==='field'?`연구용 · 전체 재고 선택 · ${scenario(id).name}`:id==='online-task'||id==='reference'||id==='high-stack'?scenario(id).name:`검증용 · ${scenario(id).name}`}));
export { rng,shuffled } from './rng';
export function parseScenario(text:string):Scenario {
 let s:any;try{s=JSON.parse(text);}catch{throw Error('JSON 형식이 올바르지 않습니다.');}
 const check=(ok:boolean,message:string)=>{if(!ok)throw Error(message);};
 const positive=(n:any)=>typeof n==='number'&&Number.isFinite(n)&&n>0;
 const dims=(d:Dimensions)=>d&&positive(d.w)&&positive(d.d)&&positive(d.h);
 check(s?.version===1,'지원하는 시나리오 버전은 1입니다.');check(s.supplyMode===undefined||['arrival','stock-select'].includes(s.supplyMode),'공급 방식은 arrival / stock-select 중 선택합니다.');check(s.units?.length==='mm'&&s.units?.weight==='kg'&&s.units?.time==='s','단위는 mm / kg / s여야 합니다.');
 check(positive(s.pallet?.width)&&positive(s.pallet?.depth)&&positive(s.pallet?.maxHeight),'팔레트 치수는 양수여야 합니다.');
 check(Array.isArray(s.types)&&s.types.length>0&&s.types.length<=120,'박스 종류는 1~120개여야 합니다.');
 const ids=new Set();let total=0;
 for(const t of s.types){check(typeof t.id==='string'&&t.id.length>0&&!ids.has(t.id),'박스 ID는 고유한 문자열이어야 합니다.');ids.add(t.id);check(dims(t.size)&&positive(t.weight),`${t.id}: 치수와 무게는 양수여야 합니다.`);check(Number.isInteger(t.quantity)&&t.quantity>=0&&t.quantity<=120,`${t.id}: 수량은 0~120 정수여야 합니다.`);total+=t.quantity;check(t.handling===undefined||['upright','no-top-load'].includes(t.handling),`${t.id}: 취급 제한은 upright / no-top-load만 지원합니다.`);check(Array.isArray(t.orientations)&&t.orientations.length>0&&t.orientations.every((r:any)=>ALL_ORIENTATIONS.includes(r))&&new Set(t.orientations).size===t.orientations.length,`${t.id}: 자세는 중복 없이 0, 90, whd, hwd, hdw, dhw 중 선택합니다.`);check(/^#[0-9a-f]{6}$/i.test(t.color),`${t.id}: 색상은 #RRGGBB 형식입니다.`);check(t.maxLoadKg===undefined||(typeof t.maxLoadKg==='number'&&Number.isFinite(t.maxLoadKg)&&t.maxLoadKg>=0),`${t.id}: 허용 지지하중은 0 이상입니다.`);}
 for(const t of s.types){if(t.packaging){validateSpec(t.packaging);check(t.packaging.id===t.id&&t.packaging.length===t.size.w&&t.packaging.width===t.size.d&&t.packaging.height===t.size.h&&t.packaging.grossWeight===t.weight,'BoxSpec과 박스 치수·무게 불일치');t.orientations=permittedOrientations(t.packaging);}if(t.maxLoadByAxis!==undefined){check(t.maxLoadByAxis!==null&&typeof t.maxLoadByAxis==='object'&&!Array.isArray(t.maxLoadByAxis),'방향별 강도 형식을 확인하세요.');for(const [axis,value] of Object.entries(t.maxLoadByAxis))check(['w','d','h'].includes(axis)&&typeof value==='number'&&Number.isFinite(value)&&value>=0,'방향별 강도는 w/d/h축의 0 이상 값입니다.');}check(t.maxLoadSource===undefined||t.maxLoadSource==='synthetic'&&t.maxLoadKg!==undefined,`${t.id}: 생성 강도 출처를 확인하세요.`);check(t.material===undefined||['paper','plastic','wood','unknown'].includes(t.material),`${t.id}: 재질은 paper / plastic / wood / unknown 중 선택합니다.`);check(t.strengthFactor===undefined||positive(t.strengthFactor)&&t.strengthFactor<=1,`${t.id}: 강도 보정은 0 초과 1 이하입니다.`);check(t.friction===undefined||typeof t.friction==='number'&&Number.isFinite(t.friction)&&t.friction>=0&&t.friction<=2,`${t.id}: 마찰 계수는 0~2입니다.`);}
 check(total>0&&total<=120,'전체 수량은 1~120개여야 합니다.');const c=s.constraints;check(c&&c.supportRatio>0&&c.supportRatio<=1,'지지 비율은 0 초과 1 이하입니다.');check(['each','share','off'].includes(c.heavyRule),'무게 규칙이 올바르지 않습니다.');
 check(c.robotMode===undefined||['ideal','gripper'].includes(c.robotMode),'적재 환경은 ideal / gripper 중 선택합니다.');c.stability={...DEFAULT_STABILITY,...c.stability};const st=c.stability;check(st.slendernessMode===undefined||['hard','score'].includes(st.slendernessMode),'기둥 비율 방식은 hard / score 중 선택합니다.');check(Number.isFinite(st.maxSlenderness)&&st.maxSlenderness>=1&&st.maxSlenderness<=4,'기둥 높이/받침 폭 제한은 1~4입니다.');check(Number.isFinite(st.minMarginRatio)&&st.minMarginRatio>=0&&st.minMarginRatio<=.4,'무게중심 최소 여유 비율은 0~0.4입니다.');check(Number.isFinite(st.lateralAccelerationG)&&st.lateralAccelerationG>=0&&st.lateralAccelerationG<=.5,'횡방향 가속도 가정은 0~0.5 g입니다.');check(Number.isFinite(st.loadSafetyFactor)&&st.loadSafetyFactor>=1&&st.loadSafetyFactor<=3,'상부 하중 여유 계수는 1~3입니다.');
 if(c.standingHeight===undefined)c.standingHeight={...DEFAULT_STANDING_HEIGHT};
 check(c.standingHeight&&typeof c.standingHeight.enabled==='boolean'&&typeof c.standingHeight.maxRiseMm==='number'&&Number.isFinite(c.standingHeight.maxRiseMm)&&c.standingHeight.maxRiseMm>=0&&c.standingHeight.maxRiseMm<=500,'세로 박스 높이 차는 0~500 mm, 사용 여부는 boolean이어야 합니다.');
 for(const k of ['contactTolerance','horizontalGap'])check(typeof c[k]==='number'&&Number.isFinite(c[k])&&c[k]>=0,`${k}: 0 이상이어야 합니다.`);
 for(const k of ['width','depth','height','mass','payload','lift','speed'])check(positive(c.gripper?.[k]),`그리퍼 ${k}: 양수여야 합니다.`);
 for(const k of ['margin','pickSeconds','placeSeconds'])check(typeof c.gripper?.[k]==='number'&&Number.isFinite(c.gripper[k])&&c.gripper[k]>=0,`그리퍼 ${k}: 0 이상이어야 합니다.`);
 check(c.gripper.rotationSpeed===undefined||positive(c.gripper.rotationSpeed),'그리퍼 회전 속도는 양수여야 합니다.');if(c.reach){const r=c.reach;check([r.baseX,r.baseY,r.minRadius,r.maxRadius].every(Number.isFinite)&&r.minRadius>=0&&r.maxRadius>r.minRadius,'로봇 도달 반경은 유한한 값이며 0 ≤ 최소 < 최대여야 합니다.');}
 if(c.packagingRobot){const r=c.packagingRobot;check(r.base&&[r.base.x,r.base.y,r.base.z,r.minReach,r.maxReach,r.approach].every(Number.isFinite)&&r.minReach>=0&&r.maxReach>r.minReach&&r.approach>0,'BoxSpec 3D 로봇 도달·접근 범위 오류');}
 const w=c.workspace;check(w&&Object.values(w).every(n=>typeof n==='number'&&Number.isFinite(n))&&w.xMin<w.xMax&&w.yMin<w.yMax&&w.zMax>0,'작업공간 범위를 확인하세요.');
 check(Number.isInteger(s.arrival?.seed)&&['shuffle','large-late','heavy-late','ordered','random-draw'].includes(s.arrival?.pattern),'입고 시드와 패턴을 확인하세요.');
 check(Array.isArray(s.events),'이벤트 목록이 필요합니다.');const steps=new Set();for(const e of s.events){check(Number.isInteger(e.step)&&e.step>=1&&e.step<=total&&!steps.has(e.step),'이벤트 단계는 물량 범위 내 고유한 정수여야 합니다.');steps.add(e.step);check(['damaged','missing','resize'].includes(e.kind),'지원하지 않는 이벤트입니다.');if(e.kind==='resize')check(dims(e.size),'변경된 박스 치수는 양수여야 합니다.');}
 if(s.generation){const g=s.generation;check(Number.isInteger(g.seed)&&Number.isInteger(g.typeCount)&&g.typeCount===s.types.length&&Number.isInteger(g.totalCount)&&g.totalCount===total,'랜덤 세트 생성 정보가 입력과 일치하지 않습니다.');
  if(g.model==='heterogeneous'){check(['individual','repeated'].includes(g.assortment),'박스 구성 방식이 올바르지 않습니다.');if(g.assortment==='individual')check(g.typeCount===total&&s.types.every((t:any)=>t.quantity===1),'개별 박스는 각 수량이 1이어야 합니다.');for(const axis of ['w','d','h']){const r=g.dimensions?.[axis];check(r&&Number.isInteger(r.min)&&Number.isInteger(r.max)&&r.min>=50&&r.max<=2000&&r.min<=r.max,'생성 치수 범위를 확인하세요.');}}
  else check((g.model===undefined||g.model==='legacy-grid')&&g.gridMm>=10&&g.gridMm<=100&&Number.isFinite(g.gridMm)&&g.densityKgM3>=10&&g.densityKgM3<=300&&Number.isFinite(g.densityKgM3),'이전 격자 생성 정보를 확인하세요.');
 }
 check(s.supplyMode!=='stock-select'||s.events.length===0,'재고 선택 모드는 단계별 입고 이벤트 대신 박스별 속성을 사용합니다. 이벤트 입력은 도착 순서 모드에서 실행하세요.');
 return {...(s.supplyMode?{supplyMode:s.supplyMode}:{}),...(s.generation?{generation:{...s.generation}}:{}),version:1,units:{length:'mm',weight:'kg',time:'s'},id:String(s.id||'imported'),name:String(s.name||'가져온 시나리오'),pallet:{...s.pallet},types:s.types.map((t:any)=>({id:t.id,name:String(t.name||t.id),size:{...t.size},weight:t.weight,quantity:t.quantity,orientations:[...t.orientations],...(t.packaging?{packaging:structuredClone(t.packaging)}:{}),...(t.maxLoadByAxis?{maxLoadByAxis:{...t.maxLoadByAxis}}:{}),color:t.color,...(t.material?{material:t.material}:{}),...(t.strengthFactor===undefined?{}:{strengthFactor:t.strengthFactor}),...(t.friction===undefined?{}:{friction:t.friction}),...(t.handling?{handling:t.handling}:{}),...(t.maxLoadKg===undefined?{}:{maxLoadKg:t.maxLoadKg}),...(t.maxLoadSource?{maxLoadSource:t.maxLoadSource}:{})})),constraints:structuredClone(c),arrival:{seed:s.arrival.seed,pattern:s.arrival.pattern},events:structuredClone(s.events)};
}
