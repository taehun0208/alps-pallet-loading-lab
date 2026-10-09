import {useRef} from 'react';
import './workspace-navigation.css';

/** Keep research tools available without making them compete with the live workspace. */
export function WorkspaceNavigation({select,onStrategies}:{select:(id:string)=>void;onStrategies:()=>void}){
 const menu=useRef<HTMLDetailsElement>(null);
 const choose=(action:()=>void)=>{if(menu.current)menu.current.open=false;action();};
 return <nav className="workspace-nav" aria-label="시뮬레이터 화면">
  <span className="workspace-current">공정 대시보드</span>
  <details ref={menu} className="workspace-tools" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}}>
   <summary>연구 도구 <span aria-hidden="true">⌄</span></summary>
   <div className="workspace-tools-menu">
    <p>실험 환경</p>
    {([['simulate','단일 팔레트 적재'],['packaging','포장 제약 실험'],['adaptive','변형·관측 실험'],['compare','적재 알고리즘 비교']] as const).map(([id,label])=><button key={id} onClick={()=>choose(()=>select(id))}>{label}</button>)}
    <button onClick={()=>choose(onStrategies)}>미래 공간 6전략 실험</button>
    <p>도움말·데이터</p>
    <button onClick={()=>choose(()=>select('data'))}>설정·데이터</button>
    <button onClick={()=>choose(()=>select('guide'))}>작동 원리</button>
   </div>
  </details>
 </nav>;
}
