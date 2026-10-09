// RAF timestamps are sampled at the start of the browser frame and can predate
// performance.now() sampled during an effect in that same frame.
export function frameClock(now:number,last:number){
 return {delta:Math.max(0,Math.min(.1,(now-last)/1000)),last:Math.max(last,now)};
}
