// Presentation-only palette. Original box specifications and physics stay untouched.
export const TWIN_SCENE={background:'#e7e5dc',edge:'#514b45',label:'#322d2a',text:'#edf1f3',platform:'#8b8479',wheel:'#252b30',tool:'#b8c4ca',source:'#788a95'};
export const TWIN_CELL_COLORS=['#8a8479','#7e786f','#9b9386','#6e6962'];
export const TWIN_ROBOT_PALETTE={body:'#ded8bd',steel:'#a4afb5',dark:'#262b30',accent:'#86938a',warning:'#cf705d',warningEmission:'#5a1008',gap:'#cf705d'};
const boxes:Record<string,string>={'#a9c4b0':'#759f92','#d6b57a':'#bb9969','#a5b9d5':'#789cb9','#baa7cd':'#998caa','#c9928f':'#ab8f82','#91bec2':'#72a5b0','#c6c89b':'#9ba889','#cfaa91':'#b39a7b'};
export const displayBoxColor=(source:string)=>boxes[source]??source;
