import { allowedOrientations } from './orientations';
import { oriented,volume,calculateLoads,sparseOrigins,contactsFor } from './geometry';
import { geometricFeasible } from './frontier';
import { materialInfo } from './materials';
import { DEFAULT_STABILITY } from './types';
import { NX,NY } from './surface';
import type { InventoryAssessment,PlanningInput,Placement } from './types';
import type { surface } from './surface';
export const emptyInventory=():InventoryAssessment=>({opportunity:0,fitFraction:0,foundationPenalty:0,strongerRemaining:0,types:[]});
const anchors=(limit:number)=>[...new Set([...Array.from({length:Math.floor(limit/2)+1},(_,i)=>i*2),limit])];
// Deterministic quantity/volume-weighted probes. These are opportunity estimates, not packing guarantees.
export function assessInventory(input:PlanningInput,placed:Placement[],map:ReturnType<typeof surface>,current:Placement):InventoryAssessment {
 if(input.settings.inventoryMode==='none')return emptyInventory();
 const cfg=input.constraints.stability||DEFAULT_STABILITY,loads=calculateLoads(placed),properties=new Map(placed.map(b=>[b.id,materialInfo(b,cfg)])),byId=new Map(placed.map(b=>[b.id,b]));
 let totalDemand=0,possibleDemand=0,opportunity=0,strongerRemaining=0,strongerDemand=0,strongerArea=0,largestStrongArea=0;
 const currentStrength=materialInfo(current,cfg).capacity??0,types:InventoryAssessment['types']=[];
 for(const type of input.types){const quantity=input.remaining[type.id]||0;if(!quantity)continue;let fitSites=0,sampleSites=0;
  if(input.settings.inventoryMode==='geometry'){
   for(const rotation of allowedOrientations(type.size,type.orientations,type.handling,type.maxLoadByAxis)){const size=oriented(type.size,rotation),origins=sparseOrigins(input.pallet,size,placed,input.constraints.horizontalGap).filter(v=>v.x>=0&&v.y>=0&&v.x+size.w<=input.pallet.width&&v.y+size.d<=input.pallet.depth),groups=new Map<number,typeof origins>();
    for(const v of origins)groups.set(v.z,[...(groups.get(v.z)||[]),v]);const probes:typeof origins=[],lists=[...groups.values()];for(let n=0;probes.length<32;n++){let found=false;for(const list of lists)if(list[n]&&probes.length<32){probes.push(list[n]);found=true;}if(!found)break;}
    for(const position of probes){sampleSites++;const r={position,size,orientation:rotation};if(!geometricFeasible(r,placed,input.pallet,input.constraints))continue;const future={...type,id:`inventory-${type.id}`,typeId:type.id,position,size,orientation:rotation,supports:[],supportRatio:1,loadAbove:0},contacts=contactsFor(future,placed,input.constraints.contactTolerance);
     if(contacts.some(c=>{const owner=byId.get(c.id)!,capacity=properties.get(c.id)!.capacity,share=c.area/(size.w*size.d);return owner.handling==='no-top-load'||capacity!==null&&loads[c.id]+type.weight*share>capacity||input.constraints.heavyRule==='each'&&type.weight>owner.weight||input.constraints.heavyRule==='share'&&type.weight*share>owner.weight;}))continue;fitSites++;
    }
   }
  }else{
  for(const rotation of allowedOrientations(type.size,type.orientations,type.handling,type.maxLoadByAxis)){const size=oriented(type.size,rotation),w=Math.ceil(size.w/(input.pallet.width/NX)),d=Math.ceil(size.d/(input.pallet.depth/NY));if(w>NX||d>NY)continue;
   for(const y of anchors(NY-d))for(const x of anchors(NX-w)){sampleSites++;const first=map.heights[y*NX+x],contact=new Map<string,number>();let supported=true;
    if(first+size.h>input.pallet.maxHeight)continue;
    for(let yy=y;yy<y+d&&supported;yy++)for(let xx=x;xx<x+w;xx++){const i=yy*NX+xx;if(Math.abs(map.heights[i]-first)>input.constraints.contactTolerance){supported=false;break;}const owner=map.owners[i];if(owner)contact.set(owner.id,(contact.get(owner.id)||0)+1);}
    if(!supported)continue;for(const [id,cells] of contact){const owner=byId.get(id)!,capacity=properties.get(id)!.capacity,share=cells/(w*d);if(owner.handling==='no-top-load'||capacity!==null&&(loads[id]+type.weight*share>capacity)||input.constraints.heavyRule==='each'&&type.weight>owner.weight||input.constraints.heavyRule==='share'&&type.weight*share>owner.weight){supported=false;break;}}
    if(supported)fitSites++;
   }
  }
  }
  const demand=quantity*volume(type.size);totalDemand+=demand;possibleDemand+=fitSites?demand:0;opportunity+=demand*(sampleSites?fitSites/sampleSites:0);types.push({id:type.id,quantity,fitSites,sampleSites});
  const strength=materialInfo(type,cfg).capacity??0;if(strength>currentStrength*1.1){strongerRemaining+=quantity;strongerDemand+=demand;strongerArea+=quantity*type.size.w*type.size.d;largestStrongArea=Math.max(largestStrongArea,type.size.w*type.size.d);}
 }
 const freeFloorArea=map.heights.filter(h=>h===0).length*input.pallet.width*input.pallet.depth/(NX*NY);
 const reserved=current.position.z===0&&strongerRemaining&&totalDemand?(strongerDemand/totalDemand)*Math.min(1,current.size.w*current.size.d/Math.max(1,largestStrongArea))*Math.min(2,strongerArea/Math.max(1,freeFloorArea)):0;
 const exposedStrongArea=map.owners.filter(b=>{if(!b||b.handling==='no-top-load')return false;const capacity=properties.get(b.id)!.capacity;return capacity!==null&&capacity>currentStrength*1.1&&capacity-loads[b.id]>=current.weight;}).length*input.pallet.width*input.pallet.depth/(NX*NY);
 // Prefer using a strong exposed base already present instead of starting another weak floor column.
 const reuse=current.position.z===0?.5*Math.min(1,exposedStrongArea/(current.size.w*current.size.d)):0;
 const foundationPenalty=reserved+reuse;
 return {opportunity:totalDemand?opportunity/totalDemand:1,fitFraction:totalDemand?possibleDemand/totalDemand:1,foundationPenalty,strongerRemaining,types};
}
