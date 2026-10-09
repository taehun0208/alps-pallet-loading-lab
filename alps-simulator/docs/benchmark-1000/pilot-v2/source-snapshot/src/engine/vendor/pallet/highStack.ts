import type { BoxType } from './types';

// A disclosed, stackable test assortment. Individual dimensions do not tile the pallet.
// All 24 boxes must be physically accessible for the stock-select demonstration.
export function highStackBoxes():BoxType[] {
 const widths=[537,523,549,531],depths=[441,457,433,449],heights=[247,239,253,231,257,245];
 const colors=['#6bcab7','#e8b86a','#80a9e8','#cc97df','#e69ca3','#93c788'];
 return Array.from({length:24},(_,i)=>{
  const tier=Math.floor(i/4),j=i%4;
  return {id:`H${i+1}`,name:`혼합 ${i+1}`,size:{w:widths[j]-tier*24,d:depths[j]-tier*18,h:heights[tier]},quantity:1,weight:12-tier*2,orientations:[0,90],color:colors[tier],material:tier<2?'plastic':tier<4?'wood':'paper',maxLoadKg:120-tier*18,maxLoadSource:'synthetic',friction:.5,strengthFactor:.85};
 });
}
