import { formatScore } from './evaluate';
import { cloneBoard, measure, rotations } from './board';
import { rank } from './search';
import { freezeSnapshot } from './snapshot';
import type { Analysis, Board, Candidate, Cell, Contributions, Piece, SearchConfig, Weights } from './types';
export const STAGES = ['관찰', '후보 생성', '가상 낙하', '지표 계산', '후보 비교', '미래 탐색', '최종 선택', '실제 적용'];
export type ReplayEvent = { step: number; title: string; text: string; candidateId: string | null; sequence: string[]; board: Board; highlights: Cell[]; contributions: Contributions | null; depth: number; selected: boolean; kind: string };
export function explainChoice(selected: Candidate, other: Candidate | undefined, w: Weights, depth: number): string {
  if (!other) return `합법적인 후보 중 ${depth}수 범위에서 평가가 가장 높은 행동을 선택했습니다.`;
  if (depth > 1) {
    if (other.pathScore === null) return `${depth}수까지 살아남은 경로의 평가 ${formatScore(selected.pathScore)}를 기준으로 선택했습니다. 비교 후보는 ${other.status === 'dead' ? '후속 배치가 불가능합니다' : '빔 가지치기에서 제외되어 같은 깊이의 평가가 없습니다'}.`;
    const difference = (selected.pathScore ?? 0) - other.pathScore;
    const sc=selected.pathContributions!,oc=other.pathContributions!;
    const names={lines:'누적 줄 삭제 보상',height:'마지막 보드 높이',holes:'마지막 보드 구멍',bumpiness:'마지막 보드 울퉁불퉁함',well:'마지막 보드 웰 보존',tetris:'누적 4줄 추가 보상',danger:'마지막 보드 위험 높이'};
    const lead=(['lines','height','holes','bumpiness','well','tetris','danger'] as const).map(key=>({key,delta:(sc[key]??0)-(oc[key]??0)})).sort((a,b)=>b.delta-a.delta)[0];
    if(Math.abs(difference)<1e-8)return `${depth}수 경로 평가가 같습니다. 끝 보드의 구멍·최대 높이, 회전과 x 순서로 동점을 처리했습니다.`;
    return `${depth}수 후 경로 평가가 ${formatScore(difference)}점 높습니다. ${names[lead.key]}의 기여가 ${formatScore(lead.delta)}점 유리하며, 최종 보드의 구멍은 ${selected.finalMetrics?.holes}칸입니다.`;
  }
  const keys = ['lines','height','holes','bumpiness','well','tetris','danger'] as const;
  const names = { lines:'줄 삭제 보상', height:'높이 패널티', holes:'구멍 패널티', bumpiness:'울퉁불퉁함 패널티',well:'웰 보존',tetris:'4줄 추가 보상',danger:'위험 높이 패널티' };
  const differences = keys.map(key=>({key,delta:(selected.contributions[key]??0)-(other.contributions[key]??0)})).sort((a,b)=>b.delta-a.delta);
  const lead = differences[0];
  if (Math.abs(selected.immediate - other.immediate) < 1e-8) return '평가값이 같습니다. 구멍 수 → 최대 높이 → 회전 번호 → x 순서로 동점을 처리합니다.';
  if (lead.key === 'holes') return `구멍 ${other.metrics.holes-selected.metrics.holes}칸을 줄여 ${formatScore(lead.delta)}점의 손해를 피합니다. 구멍 한 칸의 패널티는 ${w.holes}점입니다.`;
  return `${names[lead.key]}에서 ${formatScore(lead.delta)}점 유리합니다. ${selected.strategy?'기본 지표와 전략 기여':'네 지표'}를 모두 합치면 비교 후보보다 ${formatScore(selected.immediate-other.immediate)}점 높습니다.`;
}
export function replayEvents(board: Board, current: Piece, analysis: Analysis, config: SearchConfig, weights: Weights, lesson='holes'): ReplayEvent[] {
  const selected = analysis.candidates.find(c=>c.id===analysis.selectedId);
  const immediateBest=[...analysis.candidates].sort((a,b)=>rank({score:a.immediate,metrics:a.metrics,actions:[a.action]},{score:b.immediate,metrics:b.metrics,actions:[b.action]}))[0];
  const illustration = lesson==='clear'||lesson==='beam'||lesson.startsWith('well-')?selected:lesson==='future'?immediateBest:analysis.candidates.find(c=>c.metrics.holes > (selected?.metrics.holes ?? 0)) ?? selected;
  const sequence=[...new Set([immediateBest?.id,analysis.candidates.find(c=>c.id!==immediateBest?.id&&c.id!==illustration?.id)?.id,illustration?.id].filter((id):id is string=>!!id))];
  const depth = analysis.completedDepth;
  const titles = ['블록 하나, 여러 가능성', '돌리고, 옮겨서 후보를 만듭니다', '놓기 전에 결과를 미리 봅니다', '빈칸에도 서로 다른 의미가 있습니다', '같은 기준으로 나란히 비교합니다', config.algorithm==='greedy' ? '지금의 결과까지만 봅니다' : '다음 블록까지 시야를 넓힙니다', '현재 설정에서 선택한 수', '이제 실제 보드에 적용합니다'];
  const texts = [
    `${current}블록을 어느 방향으로 돌려 어느 열에 놓을지 결정합니다. 먼저 현재 블록과 공개된 NEXT를 살펴보세요.`,
    `회전과 가로 위치를 조합하면 ${analysis.candidates.length}개의 합법적인 착지 후보가 나옵니다. 위 경계에서 실패한 ${analysis.stats[0]?.failures ?? 0}개는 제외했습니다.`,
    illustration ? `회전 ${illustration.action.rotation}, x=${illustration.action.x}에서 수직 낙하한 모습입니다. 가상 보드이므로 실제 진행 상태는 바뀌지 않습니다.` : '합법적인 배치가 없습니다. 보드를 초기화하거나 편집해 보세요.',
    illustration ? `줄 삭제 후 구멍은 ${illustration.metrics.holes}칸입니다. 위에 블록이 덮인 빈칸만 세며, 위로 열린 홈은 구멍이 아닙니다. 구멍 기여 점수는 ${formatScore(illustration.contributions.holes)}점입니다.` : '현재 상태에서는 평가할 합법적인 후보가 없습니다.',
    `후보를 실제 평가 순서로 정렬했습니다. 카드를 누르면 착지 결과가 바뀌고, 고정 버튼으로 두 후보를 비교할 수 있습니다.`,
    config.algorithm==='greedy' ? '한 수 선택(Greedy)은 현재 블록 직후만 비교하므로 미래 가지를 확장하지 않습니다.' : `${depth}수 범위에서 실제로 ${analysis.evaluated}개 후보를 평가했습니다. 줄 삭제 보상은 누적하고 마지막 보드의 패널티만 더합니다.`,
    selected ? explainChoice(selected, analysis.candidates.find(c=>c.id!==selected.id), weights, depth) : '끝까지 놓을 수 있는 경로가 없습니다. 게임 오버로 처리합니다.',
    selected ? `${current}블록을 고정하고 ${selected.metrics.lines}줄을 지웁니다. 이 결정은 한 번만 적용되며, 되감아도 새로운 블록을 소비하지 않습니다.` : '배치할 수 없어 실제 보드를 바꾸지 않습니다.',
  ];
  if(lesson==='placements')texts[1]=`${current}블록의 서로 다른 회전은 ${rotations(current).length}개입니다. 각 회전에서 가능한 x를 검사해 ${analysis.candidates.length}개의 수직 착지를 찾았습니다. 벽과 기존 블록을 통과하지 않습니다.`;
  if(lesson==='surface'&&illustration){titles[3]='이웃한 높이 차이를 더합니다';const heights=illustration.metrics.heights,terms=heights.slice(1).map((h,x)=>Math.abs(h-heights[x]));texts[3]=`인접한 열의 높이 차이를 절댓값으로 더합니다. ${terms.join(' + ')} = ${illustration.metrics.bumpiness}입니다. 울퉁불퉁함의 기여 점수는 ${formatScore(illustration.contributions.bumpiness)}점입니다.`;}
  if(lesson==='clear'&&illustration){titles[3]='줄 삭제 뒤의 보드로 평가합니다';texts[3]=`${illustration.metrics.lines}줄을 동시에 지웁니다. 삭제 전 높이 합 ${measure(illustration.beforeClear).height}에서 삭제 후 ${illustration.metrics.height}로 바뀝니다. 줄 삭제 보상은 ${formatScore(illustration.contributions.lines)}점이며, 패널티는 삭제 후 보드에서 잽니다.`;}
  if(lesson==='future'&&selected&&immediateBest&&config.algorithm!=='greedy'){texts[5]=selected.id!==immediateBest.id?`당장에는 회전 ${immediateBest.action.rotation}, x=${immediateBest.action.x}가 ${formatScore(immediateBest.immediate)}점으로 높습니다. ${depth}수까지 보면 회전 ${selected.action.rotation}, x=${selected.action.x}의 경로 ${formatScore(selected.pathScore)}점을 선택합니다.`:`현재 상태에서는 즉시평가와 ${depth}수 탐색이 같은 첫 행동을 선택합니다. 경로 평가는 ${formatScore(selected.pathScore)}점입니다.`;}
  if(lesson==='beam'&&config.algorithm==='beam'){texts[5]=analysis.stats.map(s=>`${s.depth}수: ${s.generated}개 생성 → ${s.kept}개 유지, ${s.pruned}개 제외`).join('. ')+`. 매 깊이 전체 자식을 함께 정렬하고 상위 K=${config.width}개만 남깁니다.`;}
  if(config.strategy&&config.strategy!=='balanced'&&selected?.strategy){
    const well=selected.strategy;
    titles[0]='I 블록의 수직 통로를 남깁니다';texts[0]=`x=${well.column}은 예약 열입니다. 공개된 현재 블록과 NEXT만 보며, 웰 밖 표면을 쌓고 네 줄이 준비되면 I로 회수합니다. 무조건 기다리지는 않습니다.`;
    titles[3]=well.dangerLevels?'높이와 웰을 함께 평가합니다':'열린 웰과 막힌 구멍을 구분합니다';
    texts[3]=`선택 후보의 예약 열은 ${well.open?'열려':'막혀'} 있고, 연속 준비 줄은 ${well.readyRows}줄입니다. 웰 기여 ${formatScore(selected.contributions.well??0)}점, 위험 높이 기여 ${formatScore(selected.contributions.danger??0)}점, 4줄 추가 보상 ${formatScore(selected.contributions.tetris??0)}점이 기본 네 지표에 더해집니다.`;
    if(lesson==='well-cashout'&&config.algorithm!=='greedy')texts[5]=`${depth}수 경로에서 ${selected.path.map(a=>`${a.piece} r${a.rotation}/x${a.x}`).join(' → ')}를 계산했습니다. 누적 기본 줄 보상 ${formatScore(selected.pathContributions?.lines??0)}점과 누적 4줄 추가 보상 ${formatScore(selected.pathContributions?.tetris??0)}점을 마지막 보드 평가에 더합니다.`;
    if(lesson==='well-danger')texts[0]=`현재 최대 높이는 ${measure(board).maxHeight}칸입니다. 12칸을 넘으면 제곱 위험 패널티가 커집니다. 이번 선택은 ${selected.metrics.lines}줄을 지워 최대 높이를 ${selected.metrics.maxHeight}칸으로 바꿉니다.`;
  }
  return freezeSnapshot(STAGES.map((_, step) => {
    const candidate = step >= 6 ? selected : illustration;
    return { step, title: titles[step], text: texts[step], candidateId: candidate?.id ?? null, sequence:step===2?sequence:[], board: cloneBoard(step < 2 ? board : candidate?.board ?? board), highlights: step === 3 ? (candidate?.metrics.holeCells ?? []).map(c=>({...c})) : [], contributions: candidate?{...candidate.contributions}:null, depth: step === 5 ? depth : 1, selected: step>=6, kind: ['observe','generate','simulate','features','score','expand','select','lock'][step] };
  }));
}
