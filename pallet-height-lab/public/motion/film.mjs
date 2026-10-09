/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Motion film · studied reference: https://prompt-motion.com/rneayan-ea6129
 * Original diagrams and choreography; oscilloscope-inspired grid and restrained phosphor traces.
 */
export const DURATION=80;
export const W=1600,H=900;
export const C={bg:'#071114',panel:'#0b1b20',grid:'#173038',rule:'#29444c',ink:'#eff9f5',muted:'#a0bab8',dim:'#89a3a5',mint:'#a0f3d1',mintSide:'#285c51',mintFront:'#173c36',mintTop:'#367767',amber:'#efbd83',amberSide:'#75502d',amberFront:'#382e22',amberTop:'#a17644',red:'#ef948c',blue:'#a8c9ec',blueSide:'#3e5970',blueFront:'#203543',blueTop:'#607c93',clear:'rgba(0,0,0,0)'};
export const FONT='"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
export const MONO='"Consolas", monospace';
export const CHAPTERS=[
 {at:0,title:'공간을 읽는 물류 셀',line:'인입부터 반출까지, 하나의 흐름.',body:'서로 다른 박스를 네 로봇이 나누어 적재합니다. 완료된 팔레트의 검사와 반출, 빈 팔레트 복귀까지 연결합니다.'},
 {at:8,title:'01 · 인입과 계측',line:'반복 입력 대신, 들어오는 박스를 읽는다.',body:'작업 환경과 박스 세트를 고릅니다. 시뮬레이터는 4개 인입 레인의 배치 입고를 먼저 완료하고 합성 치수·무게·허용 하중을 읽습니다. 실제 센서 연동은 향후 단계입니다.'},
 {at:16,title:'02 · 도착 재고와 자세',line:'크기부터, 놓을 수 있는 방향까지.',body:'크기·무게·재질별 허용 하중과 회전 제한을 읽습니다. 내용물의 무게는 박스 안에 균일하게 분포한다고 가정합니다.'},
 {at:24,title:'03 · 후보 위치 검사',line:'안정적인 후보만 남긴다.',body:'경계·겹침·지지면·누적 하중·정적 평형을 검사합니다. 공구 외형과 여유 공간, 가상 로봇 도달과 운반 경로도 확인합니다.'},
 {at:32,title:'04 · 다음 공간 보존',line:'지금 놓는 한 개가, 다음을 막지 않도록.',body:'낮고 넓은 받침, 측면 접촉, 묻히는 빈틈을 평가합니다. 상부 적재 금지 박스가 다른 재고의 받침을 닫는지도 확인합니다.'},
 {at:40,title:'05 · 네 팔의 순환 협업',line:'옆으로 보내고, 다시 판단한다.',body:'방해되거나 적재할 수 없는 박스는 인접 전달대로 보냅니다. 받는 팔은 직접 적재하거나 자기 재고에 보관합니다. 공유 경로는 배타 예약합니다.'},
 {at:48,title:'06 · 남은 높이 조합',line:'낮은 틈부터, 높이 한도 가까이.',body:'남은 박스의 허용 자세와 높이 조합을 점수에 반영합니다. 실제로 올릴 때는 지지·하중·높이 조건을 다시 검사합니다.'},
 {at:56,title:'07 · 공구와 작업시간',line:'공구 두께도, 이동시간도 판단에 포함.',body:'그리퍼 외형과 여유 공간은 실제 검사 입력입니다. 이동거리/속도와 회전시간 중 큰 값에 파지 시간을 더합니다. 협동로봇 프리셋은 속도와 가반하중을 낮춘 가정이며 안전 인증 모델은 아닙니다.'},
 {at:64,title:'08 · 검사와 팔레트 반출',line:'팔이 멈추면, 물류가 이어진다.',body:'추가 작업이 없고 모든 팔이 정지한 뒤 검사와 출고를 진행합니다. AMR은 셀당 1대·분리된 직선 통로를 가정합니다. 빈 팔레트가 복귀하며 미적재 재고와 반출 명세는 보존됩니다.'},
 {at:72,title:'09 · 엣지에서의 판단',line:'입력은 적게. 탐색은 필요한 만큼.',body:'AI 추론 없이 브라우저 Worker에서 계산합니다. 높이 정책은 후보 수를 단계적으로 제한하고, 같은 셀 결과를 캐시합니다. 실제 계산시간·검사 후보·캐시 재사용은 시뮬레이터 UI에서 확인합니다.'}
];
export const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const ease=n=>{n=clamp(n);return n*n*(3-2*n);};
const lerp=(a,b,t)=>a+(b-a)*t;
export function chapterAt(t){return Math.min(CHAPTERS.length-1,Math.floor(clamp(t,0,DURATION)/8));}
function text(g,s,x,y,size=24,color=C.ink,weight=400,align='left',mono=false){g.font=`${weight} ${size}px ${mono?MONO:FONT}`;g.textAlign=align;g.textBaseline='alphabetic';g.fillStyle=color;g.fillText(s,x,y);}
function line(g,x1,y1,x2,y2,color=C.rule,width=1,alpha=1){g.save();g.globalAlpha*=alpha;g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();g.restore();}
function poly(g,p,fill,stroke=C.mint,width=1.4){g.beginPath();p.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fillStyle=fill;g.fill();g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}
function dot(g,x,y,r,color=C.mint,glow=0){g.save();g.fillStyle=color;g.shadowColor=color;g.shadowBlur=glow;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.restore();}
function pill(g,s,x,y,color=C.mint,w=130){g.save();g.fillStyle=C.panel;g.fillRect(x,y-25,w,38);g.strokeStyle=C.rule;g.strokeRect(x,y-25,w,38);text(g,s,x+13,y,17,color,500);g.restore();}
function project(x,y,z,ox,oy,scale=1){return [ox+(x-y)*.87*scale,oy+(x+y)*.43*scale-z*scale];}
function box(g,x,y,z,w,d,h,ox,oy,scale=1,tone='mint',alpha=1,wire=false){
 g.save();g.globalAlpha*=alpha;const p=(a,b,c)=>project(a,b,c,ox,oy,scale),edge=C[tone]||C.mint;
 poly(g,[p(x,y,z+h),p(x+w,y,z+h),p(x+w,y+d,z+h),p(x,y+d,z+h)],wire?C.clear:C[tone+'Top'],edge);
 poly(g,[p(x,y+d,z),p(x+w,y+d,z),p(x+w,y+d,z+h),p(x,y+d,z+h)],wire?C.clear:C[tone+'Front'],edge);
 poly(g,[p(x+w,y,z),p(x+w,y+d,z),p(x+w,y+d,z+h),p(x+w,y,z+h)],wire?C.clear:C[tone+'Side'],edge);
 g.restore();
}
function floor(g,ox,oy,size=300,scale=1){
 for(let i=0;i<=size;i+=50){let a=project(i,0,0,ox,oy,scale),b=project(i,size,0,ox,oy,scale);line(g,...a,...b,C.rule,1);a=project(0,i,0,ox,oy,scale);b=project(size,i,0,ox,oy,scale);line(g,...a,...b,C.rule,1);}
 box(g,0,0,-14,size,size,14,ox,oy,scale,'blue',.35);
}
function trace(g,p,t,color=C.mint,width=2){
 g.save();g.strokeStyle=color;g.lineWidth=width;g.beginPath();const count=(p.length-1)*clamp(t);g.moveTo(...p[0]);for(let i=1;i<=Math.floor(count);i++)g.lineTo(...p[i]);const n=Math.floor(count);if(n<p.length-1)g.lineTo(lerp(p[n][0],p[n+1][0],count-n),lerp(p[n][1],p[n+1][1],count-n));g.stroke();g.restore();
}
function heading(g,k,title,lines,t){
 const a=ease(t/1.1);g.save();g.globalAlpha*=a;g.translate(0,(1-a)*24);text(g,k,92,238,19,C.mint,500,'left',true);title.forEach((s,i)=>text(g,s,88,338+i*88,70,C.ink,600));lines.forEach((s,i)=>text(g,s,92,545+i*37,25,C.muted));g.restore();
}
function measure(g,x,y,length,label,t){trace(g,[[x,y],[x+length,y]],ease(t),C.muted);line(g,x,y-6,x,y+6,C.muted);line(g,x+length,y-6,x+length,y+6,C.muted);text(g,label,x+length/2,y-13,18,C.muted,400,'center',true);}
function machine(g,x,y,t,color=C.mint,scale=1){
 g.save();g.translate(x,y);g.scale(scale,scale);const a=Math.sin(t*1.25)*.35,b=Math.cos(t*.95)*.4;const elbow=[-36+15*a,-47-8*b],end=[22+27*a,-72+28*b];
 g.fillStyle=C.panel;g.strokeStyle=color;g.lineWidth=1.4;g.beginPath();g.ellipse(0,6,20,9,0,0,Math.PI*2);g.fill();g.stroke();
 trace(g,[[0,0],elbow,end],1,C.panel,14);trace(g,[[0,0],elbow,end],1,color,5);dot(g,0,0,6,color);dot(g,...elbow,5,color);dot(g,...end,4,color);line(g,end[0],end[1],end[0],end[1]+15,color,3);line(g,end[0]-9,end[1]+15,end[0]+9,end[1]+15,color,3);g.restore();
}
function intro(g,t){
 heading(g,'PALLET / INTELLIGENCE',['공간을 읽고.','다음을 남긴다.'],['크기가 달라도. 순서가 달라도.','네 로봇의 판단은 계속된다.'],t);
 const a=ease(t/2);g.save();g.translate(1010,350);g.scale(.95+a*.05,.95+a*.05);floor(g,0,80,300,1.18);
 const boxes=[[0,0,0,160,155,85],[160,0,0,140,155,110],[0,155,0,120,145,70],[120,155,0,180,145,70],[0,0,85,160,155,105],[160,0,110,140,155,110],[0,155,70,175,145,90],[175,155,70,125,145,115]];
 boxes.forEach((b,i)=>{const p=ease((t-.3-i*.24)/1.25);box(g,b[0],b[1],b[2]+(1-p)*170,...b.slice(3),0,80,1.18,i===4?'amber':i%3===0?'blue':'mint',p);});
 const scan=(t*.2)%1;const y=-80+scan*300;line(g,-270,y,320,y,C.mint,1,.18);g.restore();
 pill(g,'4 ROBOTS',800,790,C.mint,150);pill(g,'RULE-BASED',968,790,C.muted,182);pill(g,'3D PACKING',1168,790,C.muted,185);
}
function inventory(g,t){
 heading(g,'02 / OBSERVE',['박스마다','조건이 다르다.'],['도착한 재고에서 크기·하중을 읽고,','허용된 방향으로 후보를 만든다.'],t);
 const ox=1025,oy=425;const pose=Math.floor(t/2.4)%3;const dims=[[235,145,125],[145,235,125],[125,145,235]][pose];floor(g,ox-28,oy+25,290,.96);
 box(g,0,0,38+Math.sin(t*1.2)*8,...dims,ox,oy,1.1,'mint');
 const labels=['가로·세로 회전','가로·세로 회전','옆면 세우기'];pill(g,labels[pose],985,723,C.mint,192);
 measure(g,790,613,280,'DIMENSIONS',t-.5);
 ['크기  ×  무게','허용 하중','자세 제한'].forEach((s,i)=>{const a=ease((t-.6-i*.4)/.7);g.save();g.globalAlpha=a;line(g,1250,310+i*80,1330,310+i*80,C.rule);dot(g,1250,310+i*80,3);text(g,s,1344,317+i*80,22,C.muted);g.restore();});
 text(g,'↑ 위아래 유지 박스는 세우기 제외',1050,782,19,C.dim,400,'center');
}
function checks(g,t){
 heading(g,'03 / FILTER',['안정적인 후보만','남긴다.'],['지지와 하중을 먼저 검사하고,','겹치거나 벗어난 위치는 제외한다.'],t);
 const ox=1010,oy=410;floor(g,ox,oy,300,.98);box(g,0,0,0,290,280,80,ox,oy,.98,'blue');
 const accept=t>3.6,p=ease((t-3.6)/1.3);const x=lerp(250,45,p),z=lerp(160,80,p);box(g,x,45,z,170,185,100,ox,oy,.98,accept?'mint':'amber',1,!accept);
 if(!accept){const pos=project(335,110,265,ox,oy,.98);text(g,'지지 부족',pos[0],pos[1]-20,22,C.red,600,'center');line(g,pos[0]-40,pos[1]+7,pos[0]+40,pos[1]+7,C.red,2);}
 const labels=['팔레트 경계 · 박스 겹침','지지면 · 무게중심 · 누적 하중','가상 도달 · 운반 경로'];labels.forEach((s,i)=>{const pass=t>1+i*.9;dot(g,803,700+i*35,4,pass?C.mint:C.dim);text(g,s,822,707+i*35,20,pass?C.ink:C.dim);});
 if(accept){const pos=project(130,130,180,ox,oy,.98);dot(g,pos[0],pos[1],5,C.mint,16);line(g,pos[0],pos[1],pos[0],pos[1]+84,C.mint,1,.6);pill(g,'VALID CANDIDATE',1115,285,C.mint,238);}
}
function future(g,t){
 heading(g,'04 / PRESERVE',['빈틈은 채우고.','받침은 남긴다.'],['지금 놓으면 다음 박스를 막는가?','상부 적재 금지 박스는 잠시 보류.'],t);
 const ox=985,oy=430;floor(g,ox,oy,310,.94);box(g,0,0,0,300,280,82,ox,oy,.94,'mint');
 const p=ease((t-2.5)/1.6);box(g,lerp(70,365,p),lerp(45,10,p),lerp(82,0,p),160,160,50,ox,oy,.94,'amber');
 box(g,10,10,90,270,250,130,ox,oy,.94,'mint',.25+.6*p,true);
 if(p<.5){text(g,'상부 적재 금지',1070,282,22,C.amber,600);line(g,1070,296,1065,356,C.amber);}
 if(p>.3){g.save();g.globalAlpha=p;text(g,'후속 받침 보존',866,206,24,C.mint,500);text(g,'임시 보류',1360,740,22,C.amber,500,'center');g.restore();}
 measure(g,830,780,340,'FUTURE SUPPORT',t-3);
}
function relay(g,t){
 heading(g,'05 / CIRCULATE',['네 팔은 동시에.','판단은 각자.'],['옆 전달대에서 받은 박스를','바로 적재하거나 자기 재고로.'],t);
 const cx=1070,cy=447,rx=245,ry=187;const nodes=Array.from({length:4},(_,i)=>{const a=-Math.PI/2+i*Math.PI/2;return [cx+Math.cos(a)*rx,cy+Math.sin(a)*ry];});
 nodes.forEach((n,i)=>{const q=nodes[(i+1)%4],mid=[(n[0]+q[0])/2,(n[1]+q[1])/2];line(g,...n,...q,C.rule,2);g.strokeStyle=C.dim;g.strokeRect(mid[0]-12,mid[1]-9,24,18);const p=(t*.2+i*.25)%1;const phased=p<.4?p*1.25:p<.65?.5:.5+(p-.65)/.35*.5;dot(g,lerp(n[0],q[0],phased),lerp(n[1],q[1],phased),5,C.amber,12);});
 nodes.forEach(([x,y],i)=>{g.save();g.translate(x,y);floor(g,-25,0,88,.7);box(g,0,0,0,80,80,35+12*(i%2),-25,0,.7,i%2?'blue':'mint');machine(g,61,12,t+i*.8,i%2?C.blue:C.mint,.66);text(g,`R${i+1}`,-42,-58,25,C.ink,600,'center',true);g.restore();});
 text(g,'4',cx,cy-10,82,C.mint,300,'center',true);text(g,'INDEPENDENT ARMS',cx,cy+24,16,C.muted,400,'center',true);
 pill(g,t<4?'전달대 → 직접 적재':'전달대 → 자기 재고',912,744,t<4?C.mint:C.amber,303);
 text(g,'같은 전달대·겹치는 운반 경로만 대기',1070,791,19,C.dim,400,'center');
}
function heightScene(g,t){
 heading(g,'06 / FILL',['남은 높이까지','함께 계산한다.'],['낮은 곳에서 넓게 받치고,','남은 박스의 높이 조합을 비교한다.'],t);
 const ox=1060,oy=520,scale=.85;floor(g,ox,oy,290,scale);
 const stack=[[0,0,0,150,150,80],[150,0,0,135,150,120],[0,150,0,165,135,85],[165,150,0,120,135,85],[0,0,80,145,150,135],[150,0,120,135,150,115],[0,150,85,165,130,115],[165,150,85,120,130,160],[0,0,215,140,145,100],[150,0,235,130,145,90],[0,150,200,160,125,105],[165,150,245,115,125,70]];
 stack.forEach((b,i)=>{const p=ease((t-.4-i*.24)/.95);if(p>0)box(g,b[0],b[1],b[2]+(1-p)*110,...b.slice(3),ox,oy,scale,i%4===0?'blue':'mint',p);});
 const lim=project(0,0,360,ox,oy,scale);line(g,785,lim[1],1402,lim[1],C.amber,1.5);text(g,'HEIGHT LIMIT',1420,lim[1]-16,17,C.amber,400,'right',true);
 const y=lim[1]+25;g.save();g.globalAlpha=ease((t-4)/1);text(g,'남은 높이와 자세별 높이 합 비교',812,764,23,C.mint);text(g,'조합 점수 → 실제 배치 시 제약 재검사',812,799,19,C.dim);g.restore();line(g,1420,lim[1],1420,670,C.rule);line(g,1410,670,1430,670,C.rule);
}
function closing(g,t){
 const a=ease(t/1.1);g.save();g.globalAlpha=a;text(g,'OBSERVE  /  FILTER  /  PLACE  /  UPDATE',800,213,21,C.mint,400,'center',true);text(g,'한 번의 정답보다,',800,326,68,C.ink,600,'center');text(g,'매번 더 나은 다음 배치.',800,415,68,C.ink,600,'center');
 const steps=['재고 확인','유효 후보','배치 / 전달','상태 갱신'];steps.forEach((s,i)=>{const x=350+i*300,p=(t*.5)%4;dot(g,x,521,8,Math.floor(p)===i?C.mint:C.dim,Math.floor(p)===i?18:0);if(i<3)line(g,x+22,521,x+276,521,C.rule,2);text(g,s,x,569,25,C.muted,400,'center');});
 text(g,'규칙 기반 탐색 · 4대 독립 실행 · 재고 수량 보존',800,675,26,C.ink,400,'center');text(g,'AI 학습 없이 동작하는 Mixed Palletizing',800,722,21,C.dim,400,'center');g.restore();
}
function infeed(g,t){
 heading(g,'01 / INFEED',['반복 입력은 줄이고.','박스를 읽는다.'],['환경과 박스 세트만 선택하면,','계측 → 재고 등록 → 네 셀로 분배.'],t);
 const ox=880,oy=485;box(g,-35,0,-30,550,150,30,ox,oy,.85,'blue',.6);
 for(let i=0;i<4;i++){const x=((t*65+i*145)%570)-40;box(g,x,10,0,80+i*8,110,65+i*12,ox,oy,.85,i%2?'mint':'amber');}
 trace(g,[[1115,360],[1115,260],[1215,260],[1215,413]],ease(t),C.mint,3);line(g,1115,350,1215,400,C.mint,2,.45+.4*Math.sin(t*4));
 pill(g,'SIZE / MASS / LOAD',891,703,C.mint,300);text(g,'배치 입고 완료 후 적재 · 가상 계측',1070,770,22,C.muted,400,'center');
}
function tooling(g,t){
 heading(g,'07 / TOOL & CYCLE',['공구의 두께까지.','이동의 시간까지.'],['공구 외형 + 여유 공간으로 경로 검사.','속도·가반하중은 작업 환경에 맞게.'],t);
 const ox=1035,oy=493;floor(g,ox,oy,270,.9);box(g,40,30,0,190,180,110,ox,oy,.9,'mint');
 const rise=150+Math.sin(t)*12;box(g,90,70,rise,95,85,85,ox,oy,.9,'blue');box(g,82,62,rise,111,101,85,ox,oy,.9,'mint',.65,true);
 measure(g,1250,290,150,'160 mm',t);text(g,'공구 두께 · 예시',1265,344,21,C.muted);
 pill(g,'650 mm/s',838,724,C.mint,196);pill(g,'300 mm/s',1060,724,C.blue,196);text(g,'고정 로봇 / 협동로봇 · 설정 가정',1080,787,22,C.muted,400,'center');
}
function dispatch(g,t){
 heading(g,'08 / DISPATCH',['팔이 멈추면,','다음 물류로.'],['완료 검사 → 적재 팔레트 반출.','빈 팔레트 복귀 → 다음 배치 준비.'],t);
 const outbound=t<4.8,progress=outbound?ease((t-1.8)/2.4):1-ease((t-5)/2.5),ox=900+progress*410,oy=530;
 line(g,817,651,1460,651,C.rule,2);trace(g,[[817,666],[1460,666]],ease(t/4),C.mint,2);
 box(g,0,0,-45,220,190,40,ox,oy,.8,'blue');floor(g,ox,oy,220,.8);
 if(outbound){box(g,0,0,0,110,210,135,ox,oy,.8,'mint');box(g,110,0,0,100,210,95,ox,oy,.8,'amber');box(g,110,0,95,100,210,75,ox,oy,.8,'mint');}
 pill(g,t<1.8?'검사 / 도킹':outbound?'적재 팔레트 출고':'빈 팔레트 복귀',938,731,C.mint,286);text(g,'AMR / 이동형 팔레트 · 전용 3 m 통로 가정',1090,791,20,C.muted,400,'center');
}
function edge(g,t){
 heading(g,'09 / LOCAL DECISION',['입력은 적게.','필요한 만큼 탐색.'],['상태가 바뀔 때만 다시 계산.','AI 추론 없이, 로컬 Worker에서.'],t);
 const stages=[['24','후보 / 박스종'],['64','유망 3종 확장'],['96','실패할 때 확장']];stages.forEach(([n,label],i)=>{const x=853+i*211,a=ease((t-i*.8)/1.2);g.save();g.globalAlpha=a;g.strokeStyle=i===Math.floor(t/2)%3?C.mint:C.rule;g.strokeRect(x,312,186,186);text(g,n,x+93,397,62,C.mint,400,'center',true);text(g,label,x+93,456,18,C.muted,400,'center');g.restore();});
 trace(g,[[900,555],[900,598],[1370,598],[1370,555]],ease((t-2)/2),C.mint,2);text(g,'같은 셀 결과 캐시 → 중복 탐색 감소',1115,648,24,C.ink,400,'center');text(g,'시간 · 검사 후보 · 캐시 적중은 실행 UI에서 실측',1115,730,21,C.muted,400,'center');text(g,'브라우저 측정값 ≠ 엣지 장비 성능 보증',1115,775,19,C.dim,400,'center');
}
export function renderFilm(g,time,{width=W,height=H}={}){
 const t=clamp(time,0,DURATION-.0001),chapter=chapterAt(t),local=t-chapter*8;g.save();g.setTransform(width/W,0,0,height/H,0,0);g.clearRect(0,0,W,H);g.fillStyle=C.bg;g.fillRect(0,0,W,H);
 const glow=g.createRadialGradient(1110,430,0,1110,430,600);glow.addColorStop(0,'rgba(53,107,94,.12)');glow.addColorStop(1,C.clear);g.fillStyle=glow;g.fillRect(0,0,W,H);
 for(let x=32;x<W;x+=64)line(g,x,0,x,H,C.grid,1,.4);for(let y=34;y<H;y+=64)line(g,0,y,W,y,C.grid,1,.4);
 line(g,88,119,1512,119,C.rule);text(g,'PALLET / LOADING LAB',88,81,22,C.ink,500,'left',true);dot(g,1325,72,4,C.mint,10);text(g,'ALGORITHM FILM',1344,79,17,C.muted,400,'left',true);
 const enter=ease(local/.65),leave=chapter===CHAPTERS.length-1?1:ease((8-local)/.45);g.save();g.globalAlpha=enter*leave;g.translate(0,(1-enter)*10);[intro,infeed,inventory,checks,future,relay,heightScene,tooling,dispatch,edge][chapter](g,local);g.restore();
 line(g,88,828,1512,828,C.rule);line(g,88,828,88+1424*t/DURATION,828,C.mint,2);
 text(g,CHAPTERS[chapter].title,88,873,20,C.muted);text(g,`${String(chapter+1).padStart(2,'0')} / ${String(CHAPTERS.length).padStart(2,'0')}`,1512,873,19,C.mint,400,'right',true);
 g.restore();return chapter;
}
