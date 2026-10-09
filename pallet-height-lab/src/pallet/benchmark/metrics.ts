import type { Area } from './model';
export interface MetricDefinition {key:string;area:Area;name:string;unit:string;direction:'higher'|'lower'|'neutral';source:'측정'|'정적 근사'|'시뮬레이션 추정'|'미지원';formula:string}
const m=(key:string,area:Area,name:string,unit:string,direction:MetricDefinition['direction'],source:MetricDefinition['source'],formula:string):MetricDefinition=>({key,area,name,unit,direction,source,formula});
export const METRICS:MetricDefinition[]=[
 m('utilization','efficiency','부피 적재율','%','higher','측정','적재 외곽 직육면체 부피 / 허용 팔레트 부피 × 100. 재료 자체 부피가 아님'),
 m('completion','efficiency','정상 박스 완료율','%','higher','측정','적재 정상 박스 수 / 정상 대상 수. 계획기가 아닌 평가기가 예정된 누락·파손을 제외'),
 m('count','efficiency','적재 수','개','higher','측정','공통 확정 검사를 통과한 박스'),m('unplaced','efficiency','미적재 정상 수','개','lower','측정','정상 대상 − 적재 수'),
 m('unplacedVolume','efficiency','미적재 정상 부피','m³','lower','측정','정상 관측 규격 부피 − 적재 부피'),
 m('residualVolume','efficiency','잔여 공간 부피','mm³','lower','측정','허용 팔레트 부피 − 적재 외곽 직육면체 부피. 실제 수용 가능 공간과 다름'),
 m('height','efficiency','최종 높이','mm','lower','측정','max(z + h). 완료 수량이 다르면 낮다고 우수한 것은 아님'),
 m('pallets','efficiency','팔레트 수','개','lower','미지원','단일 팔레트 실험이므로 비교 비활성'),
 m('remainingFit','efficiency','미입고 부피 수용 가능률','%','higher','정적 근사','잔여 종류별 독립 1개 검사. 유효 위치 표본이 있는 종류의 잔여 부피 비율. 동시 적재 보증 아님'),
 m('spaceOpportunity','efficiency','유효 잔여 위치 비율','%','higher','정적 근사','remainingSites의 잔여 부피 가중 유효 위치 표본 비율. 실제 미래 순서는 미사용'),
 m('comZ','stability','무게중심 높이','mm','lower','정적 근사','질량가중 질량중심 Z'),m('comOffset','stability','수평 중심 편차','mm','lower','정적 근사','질량중심 XY와 팔레트 중앙 거리'),
 m('supportMean','stability','평균 지지율','%','higher','정적 근사','배치된 박스의 바닥 지지율 평균'),m('supportMin','stability','최소 지지율','%','higher','정적 근사','박스별 바닥 지지율 최솟값'),
 m('imbalance','stability','바닥 하중 불균형','%','lower','정적 근사','(최대 사분면 반력 − 최소 사분면 반력) / 전체 질량'),
 m('minMargin','stability','최소 국부 전도 여유','mm','higher','정적 근사','모든 실행 단계·지지면의 합력 작용점 경계 거리 − 설정된 필요 거리'),
 m('tippingG','stability','최저 전도한계','g','higher','정적 근사','각 지지면에서 margin / 합력 높이의 단계별 최솟값. 강체·정적 가정, 동적 붕괴 보증 아님'),
 m('loadViolations','stability','선택 제안 하중 위반','건','lower','측정','선택한 제안의 공통 검사 거절. 강도 정보 누락 시 null'),
 m('unknownStrength','stability','명시 강도 없는 박스','개','lower','측정','재질 예제 하중에 의존하는 박스 수. 실제 강도 검증 완료로 보지 않음'),
 m('physicsSuccess','stability','동적 붕괴 검증','%','higher','미지원','이 반복시험에서 Rapier를 실행하지 않음. 기존 비교 탭의 별도 강체 검사와 구분'),
 m('meanMs','time','평균 판단시간','ms','lower','측정','계획기 호출 performance.now 실측. 평가 후처리 제외'),m('maxMs','time','최대 판단 지연','ms','lower','측정','모든 판단의 최댓값'),m('p95Ms','time','P95 판단 지연','ms','lower','측정','각 trial 판단시간 분포의 선형보간 95백분위'),m('p99Ms','time','P99 판단 지연','ms','lower','측정','각 trial 판단시간 분포의 선형보간 99백분위'),
 m('totalMs','time','총 계획시간','ms','lower','측정','계획기 호출 시간 합'),m('deadlineRate','time','시간 내 유효해 반환율','%','higher','측정','제한시간 내 유효 배치 반환 / 정상 의사결정 수'),
 m('workSeconds','time','예상 작업시간','s','lower','시뮬레이션 추정','TCP 속도·집기·배치·회전 가정으로 경로 시간 합. 가속도 입력 시 각 선분 정지-출발 사다리꼴 속도 근사, 미입력 시 등속 가정. 관절 동역학 미검증'),m('distanceM','time','TCP 이동거리','m','lower','시뮬레이션 추정','기하 경로 선분 길이 합 / 1000'),m('throughput','time','예상 처리량','boxes/h','higher','시뮬레이션 추정','적재 수 / 작업시간 × 3600, 이상적 모드 미평가'),
 m('candidates','time','검사 후보 수','개','lower','측정','계획기가 반환한 checkedCandidates 또는 후보 배열 길이 합'),m('evaluationMs','time','평가 후처리','ms','lower','측정','최종 감사와 공통 잔여 위치 평가에 걸린 시간'),
 m('orderUtilization','robustness','순서별 적재율','%','higher','측정','무작위 반복의 부피 적재율. 표의 평균/최소/표준편차/P05가 순서 강건성 지표'),m('orderSuccess','robustness','순서별 전체 성공','%','higher','측정','정상 박스 전량 완료이면서 거절·시간 초과·오류 없음이면 100, 그 외 0'),
 m('orderCompletion','robustness','무작위 정상 박스 완료율','%','higher','측정','혼합·완전 무작위 trial의 정상 박스 완료 비율. 다른 시나리오는 제외'),
 m('regret','robustness','오프라인 기준해 격차','%p','lower','측정','동일 episode 오프라인 전체 재고 부피 적재율 − 온라인 부피 적재율. 음수 가능; 최적성 보증 없음'),
 m('futureFit','robustness','미래 잔량 수용 표본','%','higher','정적 근사','현재 미입고 수량만 이용한 공통 독립 위치 검사. 실제 다음 순서 비공개'),
 m('reachProxy','robot','기하 경로 통과율','%','higher','시뮬레이션 추정','선택한 위치 제안 중 설정된 가반·접근·스윕 검사 통과율. IK·전체 링크 미검증'),m('robotCollisions','robot','선택 경로 충돌 거절','건','lower','측정','선택한 제안의 로봇 경로/충돌 제약 위반'),m('payloadViolations','robot','가반하중 거절','건','lower','측정','선택한 제안에서 확인된 가반하중 초과'),m('graspSuccess','robot','실제 흡착 성공률','%','higher','미지원','밀봉·진공·흡착 물리 미구현'),m('ikSuccess','robot','실제 로봇 IK 성공률','%','higher','미지원','관절 한계·전체 링크 경로 검증 미구현'),m('executionSuccess','robot','기하 순서 완료','%','higher','시뮬레이션 추정','정상 전량 완료 및 공통 기하 실행 제약 통과 여부. 실제 공장 실행 성공률 아님'),
 ...(['damaged','missing','resize'] as const).map((k,i)=>m(k+'Recovery','exception',['파손 박스 격리 대응','박스 누락 대응','규격 재관측 대응'][i],'%','higher','측정','실제 만난 해당 이벤트 중 정의된 대응 통과 비율. 미도달은 null')),
 m('exceptionSuccess','exception','발생 예외 대응률','%','higher','측정','실제 도달한 이벤트의 정의된 대응 통과 / 도달 이벤트 수. 미도달·미발생은 null'),m('replanMs','exception','관측 후 재계획','ms','lower','측정','규격 재관측·팔레트 변경 후 첫 판단 시간. 파손·누락은 재계획을 가장하지 않음'),m('exceptionRetention','exception','예외 후 적재율 유지','%','higher','측정','동일 박스·시드의 무사건 참조 대비 부피 적재율 비. 무사건 참조가 없거나 0이면 null'),m('palletRecovery','exception','팔레트 변경 대응','%','higher','측정','규격 축소 뒤 확정 배치가 유효하고 다음 정상 박스를 배치하면 100')
];
