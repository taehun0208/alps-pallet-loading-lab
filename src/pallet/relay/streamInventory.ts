import bedOrders from './data/bed-bpp-euro-orders.json';
import {rng,shuffled} from '../rng';
import {scenario} from '../scenarios';
import {ALL_ORIENTATIONS} from '../orientations';
import {DEFAULT_STABILITY} from '../types';
import type {BoxType,Material,Scenario} from '../types';

export function streamInventory(seed:number,count=96,maxHeight=1600,profile:InventoryProfile='synthetic'):Scenario{
 if(!['synthetic','bed-bpp','bed-bpp-stress'].includes(profile))throw Error('알 수 없는 입력 프로필입니다.');
 if(profile!=='synthetic')return benchmarkInventory(seed,count,maxHeight,profile);
 if(!Number.isInteger(seed)||!Number.isInteger(count)||count<8||count>120||!Number.isInteger(maxHeight)||maxHeight<600||maxHeight>2000)throw Error('박스 8–120개 · 높이 600–2000 mm · 정수 시드를 입력하세요.');
 const random=rng(seed),int=(a:number,b:number)=>Math.floor(a+random()*(b-a+1));
 const families=[{name:'넓은 평형',w:[480,760],d:[360,630],h:[90,210]},
  {name:'혼합 중형',w:[270,520],d:[210,450],h:[150,330]},
  {name:'소형',w:[150,330],d:[120,290],h:[75,240]},
  {name:'긴 포장',w:[520,760],d:[140,260],h:[95,230]},
  {name:'높은 포장',w:[250,390],d:[200,350],h:[340,550]},
  {name:'대형 용기',w:[410,640],d:[340,540],h:[220,420]}];
 const colors=['#a9c4b0','#d6b57a','#a5b9d5','#baa7cd','#c9928f','#91bec2','#c6c89b','#cfaa91'];
 const s=scenario('mixed',seed);s.id='continuous-mixed';s.name=`개별 혼합 ${count}개 · 시드 ${seed}`;s.events=[];s.supplyMode='arrival';s.arrival={seed,pattern:'ordered'};
 s.pallet={width:1800,depth:1500,maxHeight};
 s.constraints={...s.constraints,robotMode:'gripper',supportRatio:.92,horizontalGap:0,contactTolerance:1,
  heavyRule:'each',stability:{...DEFAULT_STABILITY,maxSlenderness:1.8,slendernessMode:'hard',minMarginRatio:.12,loadSafetyFactor:1.5},standingHeight:{enabled:true,maxRiseMm:100}};
 s.constraints.gripper={...s.constraints.gripper,payload:35,speed:850,pickSeconds:.65,placeSeconds:.7};
 const seen=new Set<string>();
 s.types=shuffled(Array.from({length:count},(_,i):BoxType=>{
  const f=families[Math.floor(random()*families.length)];let size={w:0,d:0,h:0},key='';
  do{size={w:int(f.w[0],f.w[1]),d:int(f.d[0],f.d[1]),h:int(f.h[0],f.h[1])};key=Object.values(size).join('/');}while(seen.has(key));seen.add(key);
  const material:Material=random()<.52?'paper':random()<.8?'plastic':'wood',fragile=random()<.07,upright=!fragile&&random()<.14;
  const weight=Math.round((size.w*size.d*size.h/1e9*int(35,145)+(material==='wood'?1.4:.25))*100)/100;
  return {id:`M${String(i+1).padStart(3,'0')}`,name:`${f.name} · ${material==='paper'?'골판지':material==='plastic'?'플라스틱':'목재'}`,size,weight,quantity:1,
   orientations:upright?[0,90]:[...ALL_ORIENTATIONS],material,color:colors[int(0,colors.length-1)],maxLoadKg:fragile?0:int(material==='paper'?22:55,material==='paper'?90:190),maxLoadSource:'synthetic',strengthFactor:.85,friction:.55,
   ...(fragile?{handling:'no-top-load' as const}:upright?{handling:'upright' as const}:{})};
 }),random);
 return s;
}


export type InventoryProfile='synthetic'|'bed-bpp'|'bed-bpp-stress';
interface BedItem {article:string;id:string;product_group:string;'length/mm':number;'width/mm':number;'height/mm':number;'weight/kg':number;sequence:number}
interface BedOrder {item_sequence:Record<string,BedItem>;properties:{id:string;order_nr:string;type:string;target:string}}
const dataset=bedOrders as Record<string,BedOrder>,orderKeys=Object.keys(dataset);
/** Read-only access to the bundled BED-BPP subset by original order ID (items in source sequence). */
export const bedOrderIds=()=>[...orderKeys];
export function bedOrderItems(orderId:string){const order=dataset[orderId];if(!order)throw Error(`BED-BPP 주문 없음: ${orderId}`);return Object.values(order.item_sequence).sort((a,b)=>a.sequence-b.sequence).map(i=>({article:i.article,sequence:i.sequence,size:{w:i['length/mm'],d:i['width/mm'],h:i['height/mm']},weight:i['weight/kg']}));}
export const BED_BPP_SOURCE={url:'https://floriankagerer.github.io/assets/bed-bpp/bed-bpp_v1.json',sha256:'6ecc91d92b9ce88de113ac66c45a450ac3eec303018f14cd73e4bd0eaf8eb3cc',repositoryCommit:'1b54c34428ba0f5b43a967162a57e5174d08bb7f',doi:'10.1177/02783649231193048'};
export function getInventoryProfile(s:Scenario):InventoryProfile{return s.id.startsWith('bed-bpp-stress')?'bed-bpp-stress':s.id.startsWith('bed-bpp')?'bed-bpp':'synthetic';}
function benchmarkItems(seed:number,count:number,profile:Exclude<InventoryProfile,'synthetic'>){
 const start=((seed%orderKeys.length)+orderKeys.length)%orderKeys.length,items:{orderId:string;item:BedItem}[]=[];
 for(let offset=0;offset<orderKeys.length;offset++){
  const orderId=orderKeys[(start+offset)%orderKeys.length],sequence=Object.values(dataset[orderId].item_sequence).sort((a,b)=>a.sequence-b.sequence);
  items.push(...sequence.map(item=>({orderId,item})));
  if(profile==='bed-bpp'||items.length>=count)break;
 }
 return profile==='bed-bpp'?items:items.slice(0,count);
}
/** Exact published source dimensions/weights/order, with explicitly separate simulation assumptions. */
export function benchmarkInventory(seed:number,count=120,maxHeight=1600,profile:Exclude<InventoryProfile,'synthetic'>='bed-bpp'):Scenario{
 if(!Number.isInteger(seed)||!Number.isInteger(count)||count<8||count>240||!Number.isInteger(maxHeight)||maxHeight<600||maxHeight>2000)throw Error('BED-BPP: 요청 수량 8–240개 · 높이 600–2000 mm · 정수 시드를 입력하세요.');
 const items=benchmarkItems(seed,count,profile),s=streamInventory(seed,8,maxHeight),orderIds=[...new Set(items.map(i=>i.orderId))];
 s.id=profile;s.name=profile==='bed-bpp'?`BED-BPP 원본 주문 ${orderIds[0]} · ${items.length}개`:`BED-BPP 주문 결합 용량시험 · ${items.length}개`;
 s.pallet={width:1200,depth:800,maxHeight};
 // The published environment uses two horizontal orientations. Strength/material/friction
 // are not present in the dataset; do not invent measured crushing capacities.
 s.constraints.heavyRule='off';s.constraints.standingHeight={enabled:false,maxRiseMm:100};
 s.constraints.stability={...s.constraints.stability!,slendernessMode:'score'};
 s.constraints.workspace.zMax=Math.max(2600,maxHeight+Math.max(...items.map(i=>i.item['height/mm']))+s.constraints.gripper.lift+s.constraints.gripper.height+2*s.constraints.gripper.margin);
 s.types=items.map(({orderId,item},index):BoxType=>({id:`BED-${orderId}-${String(item.sequence).padStart(3,'0')}-${index}`,name:`${item.article} · 주문 ${orderId} #${item.sequence}`,
  size:{w:item['length/mm'],d:item['width/mm'],h:item['height/mm']},weight:item['weight/kg'],quantity:1,orientations:[0,90],material:'unknown',color:['#a9c4b0','#d6b57a','#a5b9d5','#baa7cd','#c9928f','#91bec2'][index%6]}));
 return s;
}
export function inventoryProfileInfo(seed:number,profile:InventoryProfile,count=96,maxHeight=1600){
 const s=streamInventory(seed,count,maxHeight,profile),items=profile==='synthetic'?[]:benchmarkItems(seed,count,profile);
 const totalVolumeMm3=s.types.reduce((v,t)=>v+t.size.w*t.size.d*t.size.h*t.quantity,0);
 return {profile,label:profile==='synthetic'?'합성 혼합':profile==='bed-bpp'?'BED-BPP 원본 주문':'BED-BPP 주문 결합 용량시험',count:s.types.reduce((n,t)=>n+t.quantity,0),orderIds:[...new Set(items.map(i=>i.orderId))],pallet:s.pallet,totalVolumeMm3,
  fourPalletVolumeRatio:totalVolumeMm3/(4*s.pallet.width*s.pallet.depth*s.pallet.maxHeight),
  sourceUrl:profile==='synthetic'?null:BED_BPP_SOURCE.url,sourceSha256:profile==='synthetic'?null:BED_BPP_SOURCE.sha256,
  assumptions:profile==='synthetic'?['규격·중량·강도 모두 합성 예제']:['원본 규격(mm)·중량(kg)·주문 내 순서 보존','유로 팔레트 1200×800 mm · 높이 상한은 사용자 시험조건','압축강도·마찰·내용물 무게중심은 원본에 없음 · 강도 미검증','균일 밀도 강체 · 마찰계수 0.6 · 지지면적 92% · 로봇/그리퍼는 시험 가정 · 중량 상하 규칙/100mm 높이차 제한 해제',profile==='bed-bpp'?'전체 원본 주문을 4셀 환경으로 재생 · 공식 리더보드 결과 아님':'원본 주문을 결합하고 요청 수량에서 자른 파생 시험 · 공식 원본 주문/리더보드 결과 아님']};
}
