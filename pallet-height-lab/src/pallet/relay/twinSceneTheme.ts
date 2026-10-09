// Presentation-only palette. Original box specifications and physics stay untouched.
export const TWIN_SCENE={background:'#d2d7da',edge:'#39454c',label:'#30383e',text:'#edf1f3',platform:'#536b78',wheel:'#252b30',tool:'#b8c4ca',source:'#788a95'};
export const TWIN_CELL_COLORS=['#397e8c','#568391','#587587','#497f83','#6b8990','#547988','#7d8a91','#688388'];
export const TWIN_ROBOT_PALETTE={body:'#ded8bd',steel:'#a4afb5',dark:'#262b30',accent:'#86938a',warning:'#cf705d',warningEmission:'#5a1008',gap:'#cf705d'};
const boxes:Record<string,string>={'#a9c4b0':'#759f92','#d6b57a':'#bb9969','#a5b9d5':'#789cb9','#baa7cd':'#998caa','#c9928f':'#ab8f82','#91bec2':'#72a5b0','#c6c89b':'#9ba889','#cfaa91':'#b39a7b'};
export const displayBoxColor=(source:string)=>boxes[source]??source;

export const TWIN_CONVEYOR={main:'#a7453e',sub:'#376da0',scan:'#548a87'};
