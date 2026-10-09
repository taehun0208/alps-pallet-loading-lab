import { verifyPhysics } from './physics';
self.onmessage=async e=>{const m=e.data;try{self.postMessage({kind:'physics',result:await verifyPhysics(m.placements,m.pallet,m.settings,m.runId),snapshot:m.snapshot});}catch(error){self.postMessage({kind:'error',runId:m.runId,message:String(error)});}};
