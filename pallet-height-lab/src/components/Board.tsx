import { useId, useRef } from 'react';
import { measure, rotations } from '../engine/board';
import { PIECES, type Action, type Board as BoardType, type Piece } from '../engine/types';
export function PiecePreview({piece,rotation=0}:{piece:Piece;rotation?:number}) {
  const cells=rotations(piece)[rotation] ?? rotations(piece)[0];
  const w=Math.max(...cells.map(c=>c.x))+1,h=Math.max(...cells.map(c=>c.y))+1;
  return <svg className="piece-preview" viewBox={`0 0 ${w*18} ${h*18}`} role="img" aria-label={`${piece}블록 회전 ${rotation}`}><g className={`piece piece-${PIECES.indexOf(piece)+1}`}>{cells.map((c,i)=><rect key={i} x={c.x*18+1} y={c.y*18+1} width="16" height="16" rx="2"/>)}</g></svg>;
}
export function Board({board,ghost,features=false,mini=false,selected=false,dropping=false,dropDuration=450,clearRows=[],editable=false,onEdit,label='테트리스 보드',showCoordinates=true,wellColumn=null}:{board:BoardType;ghost?:Action;features?:boolean;mini?:boolean;selected?:boolean;dropping?:boolean;dropDuration?:number;clearRows?:number[];editable?:boolean;onEdit?:(b:BoardType)=>void;label?:string;showCoordinates?:boolean;wellColumn?:number|null}) {
  const pattern=useId().replaceAll(':',''),svgRef=useRef<SVGSVGElement>(null),brush=useRef<number|null>(null),lastCell=useRef('');
  const metrics=measure(board),unit=20,left=showCoordinates&&!mini?22:0,top=showCoordinates&&!mini?18:0;
  const editAt=(clientX:number,clientY:number,start=false)=>{
    if(!editable || !onEdit || !svgRef.current)return;
    const rect=svgRef.current.getBoundingClientRect(),view=svgRef.current.viewBox.baseVal;
    const x=Math.floor(((clientX-rect.left)/rect.width*view.width-left)/unit),y=Math.floor(((clientY-rect.top)/rect.height*view.height-top)/unit);
    if(x<0||x>=10||y<0||y>=20)return;
    if(start)brush.current=board[y][x]?0:8;
    const key=`${x}:${y}`; if(lastCell.current===key&&!start)return;lastCell.current=key;
    const changed=board.map(r=>[...r]);changed[y][x]=brush.current??8;onEdit(changed);
  };
  return <svg ref={svgRef} viewBox={`0 0 ${200+left+2} ${400+top+(!mini&&features?30:2)}`} className={`board-svg ${mini?'mini':''} ${editable?'editable':''}`} role="img" aria-label={label}
    onPointerDown={e=>{if(editable){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);editAt(e.clientX,e.clientY,true);}}} onPointerMove={e=>{if(brush.current!==null)editAt(e.clientX,e.clientY);}} onPointerUp={()=>{brush.current=null;lastCell.current='';}} onPointerCancel={()=>{brush.current=null;}}
    onKeyDown={e=>{if(editable&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const b=board.map(r=>[...r]);b[19][0]=b[19][0]?0:8;onEdit?.(b);}}} tabIndex={editable?0:undefined}>
    <defs><pattern id={`hole-${pattern}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" className="hole-stripe" strokeWidth="2"/></pattern></defs>
    {showCoordinates&&!mini&&Array.from({length:10},(_,x)=><text className="coord" key={`x${x}`} x={left+x*20+10} y="11" textAnchor="middle">{x}</text>)}
    {showCoordinates&&!mini&&[0,5,10,15,19].map(y=><text className="coord" key={`y${y}`} x="13" y={top+y*20+13} textAnchor="end">{y}</text>)}
    <g transform={`translate(${left},${top})`}>
      <rect className="board-ground" width="200" height="400"/>
      {board.flatMap((row,y)=>row.map((cell,x)=><rect key={`${x}:${y}`} x={x*20+1} y={y*20+1} width="18" height="18" rx="1.5" className={cell?`piece piece-${cell}`:'empty-cell'}/>))}
      {wellColumn!==null&&<g className={`well-overlay ${metrics.heights[wellColumn]?'blocked':'open'}`} aria-label={`I 블록 예약 열 x=${wellColumn}`}><rect x={wellColumn*20+1} y="1" width="18" height="398"/><path d={`M${wellColumn*20+5} 7h10l-5 7z`}/></g>}
      {features&&metrics.heights.map((h,x)=><g key={`height${x}`} className="height-overlay" style={{animationDelay:`${x*75}ms`}}><rect x={x*20+7} y={400-h*20} width="6" height={h*20}/><text x={x*20+10} y={Math.max(10,400-h*20-5)} textAnchor="middle">{h}</text></g>)}
      {features&&metrics.holeCells.map(c=><g key={`hole${c.x}:${c.y}`}><rect x={c.x*20+1} y={c.y*20+1} width="18" height="18" fill={`url(#hole-${pattern})`} className="hole-outline"/><path className="hole-cross" d={`M${c.x*20+6} ${c.y*20+6}l8 8m0-8-8 8`}/></g>)}
      {features&&metrics.heights.slice(1).map((h,x)=><g key={`bump${x}`} className="bump-overlay"><line x1={x*20+10} y1={400-metrics.heights[x]*20} x2={(x+1)*20+10} y2={400-h*20}/><text x={(x+1)*20} y={Math.max(9,400-(h+metrics.heights[x])*10-2)} textAnchor="middle">{Math.abs(h-metrics.heights[x])}</text></g>)}
      {features&&<text className="bump-label" x="100" y="420" textAnchor="middle">인접 높이 차 합계 B = {metrics.bumpiness}</text>}
      {ghost&&<g key={`${ghost.rotation}:${ghost.x}:${ghost.y}`} className={`ghost ${selected?'gold':''} ${dropping?'dropping':''}`} style={{'--drop-distance':`${Math.max(0,ghost.y)*-20}px`,animationDuration:`${dropDuration}ms`} as React.CSSProperties}>{ghost.cells.map((c,i)=><rect key={i} x={(ghost.x+c.x)*20+1} y={(ghost.y+c.y)*20+1} width="18" height="18" rx="2"/>)}</g>}
      {clearRows.map(y=><rect key={`clear${y}`} className="clear-row" x="0" y={y*20} width="200" height="20"/>)}
      <rect className="board-edge" width="200" height="400"/>
    </g>
  </svg>;
}
