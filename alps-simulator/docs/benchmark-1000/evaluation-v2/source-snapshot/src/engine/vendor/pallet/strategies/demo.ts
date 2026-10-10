import { scenario } from '../scenarios';
import type { BoxType } from '../types';
// A reproducible mixed-size input, not a pre-solved tiling. Keep generated arrivals private.
export function strategyDemo(){
  const s=scenario('online-task');delete s.generation;s.id='strategy-lab';s.name='미래 공간 비교 · 혼합 박스 18개';
  s.pallet={width:1000,depth:800,maxHeight:1400};s.supplyMode='arrival';s.arrival={seed:42,pattern:'random-draw'};s.events=[];
  const t=(id:string,size:BoxType['size'],weight:number,quantity:number,color:string):BoxType=>({id,name:id,size,weight,quantity,color,orientations:[0,90],material:'plastic',maxLoadKg:120});
  s.types=[t('Wide',{w:487,d:363,h:193},12,3,'#e1b65f'),t('Long',{w:731,d:143,h:127},6,2,'#aa9de5'),t('Small',{w:223,d:177,h:151},3,5,'#6abbaa'),t('Medium',{w:341,d:269,h:217},8,4,'#72b5c6'),t('Heavy',{w:417,d:311,h:179},18,2,'#ca879f'),t('Tall',{w:197,d:233,h:357},5,2,'#8bbb89')];
  s.types.find(t=>t.id==='Tall')!.orientations=[0,90,'whd','hwd','hdw','dhw'];
  Object.assign(s.types.find(t=>t.id==='Small')!,{material:'paper',maxLoadKg:18});
  s.constraints.robotMode='ideal';s.constraints.heavyRule='each';s.constraints.standingHeight={enabled:true,maxRiseMm:240};
  return s;
}
