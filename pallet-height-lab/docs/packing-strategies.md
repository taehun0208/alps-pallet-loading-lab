# 기존 Pallet Loading Lab — 6개 적재 전략 구현 보고서

작성: 2026-10-08. 기존 React·Three.js 시뮬레이터에 추가한 기능이며 새 앱을 만들지 않았다. AI 모델이나 학습된 정책을 호출하지 않는다.

## 1. 기존 구조 분석

`ArrivalEnvironment`가 입고 큐와 입고 난수를 소유한다. `input()`은 현재 관측·확정 적재·남은 종류별 수량만 계획기에 전달한다. `plan()` → `candidateSet()` → `inspectConstraints()`가 후보 생성·평가·하드 검사를 수행하고, `advance()`가 실제 도착 ID와 제약을 다시 확인해 확정한다. `usePallet`과 Web Worker가 계산·재생을 분리하고 `PalletScene`이 Three.js로 표시한다.

기존 `bl`, `greedy`, `rollout`에는 이미 미래 재고 평가가 섞여 있었다. 그 동작은 유지하고 미래 정보를 사용하지 않는 새 기준선을 `strategy-greedy`로 추가했다. 기존 8대 로봇 순환 적재·전체 재고 선택·임시 보류·강체 검증은 보존했다. 새로운 여섯 전략은 **순차 투입 모드 전용**이다. 미입고 박스를 꺼내는 재고 선택 모드와 혼합하지 않는다.

## 2. 수정한 파일

- `src/pallet/planner.ts`: 기존 진입점에서 새 전략 레지스트리로 분기. 기존 세 정책은 그대로 호출.
- `src/pallet/types.ts`: 전략 ID, 설정, 결정 디버그, 예약 상태와 실행 지표의 선택적 타입 추가.
- `src/pallet/environment.ts`: 새 전략에만 이전 예약 상태 전달, 실행 진단 기록. 기존 정책의 입력 키도 보존.
- `src/pallet/replanning.ts`: 명시적 부분 재계획 횟수 기록.
- `src/pallet/planner.worker.ts`: 순차 투입 비교는 새 여섯 전략, 재고 선택 비교는 기존 세 정책.
- `src/pallet/PalletLab.tsx`: 기존 selector 확장, 접힌 설정 패널, 디버그 토글, 비교·CSV·JSON 연결.
- `src/pallet/PalletScene.tsx`: 같은 Three.js 장면에 예약 wireframe과 접근 여유 표시.
- `src/pallet/CandidateFacts.tsx`, `RequirementStatus.tsx`: 선택한 전략의 실제 검사·점수와 일치하는 설명.
- `src/pallet/ConditionComparison.tsx`, `pallet.css`: 새 전략 비교 기록과 그래프 선 색상.
- `package.json`: `benchmark:strategies` 명령 추가.

## 3. 새 파일

`src/pallet/candidates.ts`는 기존 후보 생성기를 그대로 분리한 공통 모듈이다. 기존 import 호환성을 위해 planner에서도 재수출한다.

`src/pallet/strategies/`:

- `PackingStrategy.ts`: 공통 인터페이스·설정·예산 검증·결정 타입.
- `GreedyStrategy.ts`, `MacsStrategy.ts`, `TetrisReservationStrategy.ts`, `DynamicReservationStrategy.ts`, `LookaheadStrategy.ts`, `HybridStrategy.ts`: 독립 전략과 각각의 점수식.
- `index.ts`: 전략 등록·실행·기존 Analysis 형식 어댑터.
- `currentScore.ts`, `evaluator.ts`: 현재 품질 성분·공유 측정·선택된 결정의 디버그 기록.
- `feasibility.ts`: 공유 후보와 동일 하드 검사에 의한 미래 위치·Criticality·FPL·캐시.
- `freeSpace.ts`: 위에서 접근 가능한 빈 직육면체 근사.
- `lookaheadSimulation.ts`: 재고 수량에서 가상 순서 추출·고정된 후속 정책 시뮬레이션.
- `StrategyControls.tsx`: 설정·디버그 UI.
- `metrics.ts`, `benchmark.ts`, `demo.ts`: 실행 진단·동일 시드 비교·혼합 치수 예제.

검증 파일은 `tests/pallet-strategies.test.ts`와 `tests/pallet-strategy-benchmark.test.ts`이다. 측정 산출물은 이 폴더의 `strategy-benchmark.json`과 `strategy-benchmark.csv`이다.

## 4. 각 알고리즘 구현

| UI 이름 / ID | 판단 방식 |
|---|---|
| Greedy / `strategy-greedy` | 현재 박스의 공간 효율·지지·하중 안정·무게중심·평탄도·높이만 평가. 후보 평가 전에 미래 types·remaining을 제거한다. |
| MACS / `macs` | 현재 품질에 큰 접근 가능 빈 직육면체 보존을 더한다. 미래 종류·수량은 사용하지 않는다. |
| Tetris Reserved Slot / `tetris-reserved` | Critical 미래 종류 하나의 가능한 위치 하나를 예약한다. 가능한 동안 단계 사이에 유지하고 다른 박스의 침범을 크게 감점한다. 해당 종류가 실제 도착하면 예약 위치를 선호한다. |
| Dynamic Reservation / `dynamic-reservation` | Top-K 종류의 여러 가능한 위치 수 감소, 후보 완전 소멸, 무거운 미래 박스의 최하단 자리 감소를 감점한다. |
| Lookahead / `lookahead` | 현재 후보를 제한한 뒤 남은 수량으로 만든 가상 순서를 공통 적용한다. 각 가상 단계도 도착한 가상 박스 한 개만 배치한다. |
| Future-Aware Hybrid / `future-hybrid` | Dynamic의 FPL·하단 자리 보존과 MACS 빈 공간을 합산한다. |

예약은 소프트 비용이다. 모든 현재 후보가 미래를 막을 때 현재 박스를 삭제하거나 제약을 풀지 않는다. 현재 박스의 하드 유효 후보가 없으면 중단한다. 최적해를 보장하는 완전탐색 알고리즘은 아니다.

## 5. 계산복잡도와 예산

N=확정 박스 수, T=미래 종류 수, C=현재 후보 상한, B=종류별 미래 후보 상한, K=보호 종류 수, L=Lookahead 현재 후보 수, S=가상 순서 수, D=깊이, G=공간 축별 구간 수다. H(N)는 기존 누적 하중·평형·경로 검사 한 번의 비용이다. 아래는 공통 후보 생성·현재 품질 계산 외의 주요 비용이다.

| 전략 | 주요 비용 |
|---|---|
| Greedy | 공통 후보 C개 평가와 정렬 |
| MACS | `O(C × (N G² + G⁴))`, G≤16 |
| Tetris Reserved | Critical 선정 `O(T B H(N))`, 선택된 종류와 고정 예약의 후보별 재검사 |
| Dynamic | `O(T B H(N) + C K (2B) H(N))` + 공간 분할 근사 |
| Lookahead | Critical 선정 + `O(L S D B H(N+D))`와 후속 현재 품질 평가 |
| Hybrid | Dynamic + MACS |

기본은 K=3, B=12, L=6, S=4, D=3이다. UI에서 변경할 수 있다. 허용 한계는 K≤8, B≤64, L≤16, S≤20, D≤6, C≤256이다. 후보는 기존 frontier·접촉 경계·중심 정렬 생성기를 사용한다. 동일 자세의 대칭 제거도 기존 로직을 사용한다. 미래 상태·종류·예약 위치별 계산은 한 결정 안에서 캐시한다.

`F_after` 계산에서 이전 위치 B개와 새 위치 B개를 합치므로 최대 2B개를 검사한다. 이전에 알던 위치가 후보 정렬에서 밀렸다는 이유만으로 가짜 `1→0`이 생기는 것을 방지한다. Tetris의 실제 도착 예약 위치는 필요하면 현재 후보에 한 개 추가된다.

## 6. 사용한 scoring equation

모든 가중치는 `StrategyConfig.weights`와 UI에서 설정한다. 음수·NaN·범위 밖 설정은 실행 진입점에서 거부한다.

```
Q = wc·compactness + ws·support + wt·stability + wb·centerOfMass
  + wf·flatness − wh·heightPenalty

Greedy  = Q
MACS    = Q + wm·macs − wg·fragmentation
Tetris  = Q − wr·reservationPenalty
Dynamic = Q − wl·FPL − wd·deadEnds − wbott·lowerSpaceLoss − wg·fragmentation
Lookahead = Q + wa·futureReward
Hybrid  = Dynamic + wm·macs
```

compactness는 적재 부피/현재 사용 높이의 팔레트 부피, support는 현재 박스 지지율, stability는 최대 하중 사용·아랫단 중심 치우침을 반영한 0~1 품질, centerOfMass는 기존 바닥 하중 불균형의 보수, flatness는 기존 표면 평탄 비율, heightPenalty는 최대 높이/허용 높이다. 이 점수는 안정 확률이 아니다. 하드 제약을 통과한 후보 사이의 상대 평가다.

Criticality는 아래 다섯 0~1 성분의 가중 평균이다.

```
volume      = boxVolume / largestKnownTypeVolume
aspect      = min(1, (longestSide/shortestSide − 1)/5)
weight      = weight / largestKnownTypeWeight
orientation = 1 − (numberOfDistinctAllowedOrientations − 1)/5
scarcity    = 1 / (1 + feasibleBefore)
C_i = weightedMean(volume, aspect, weight, orientation, scarcity)

FPL = Σ C_i · max(0, F_before − F_after) / max(1, F_before)  // normalized
FPL = Σ C_i · max(0, F_before − F_after)                    // absolute
deadEnds = count(F_before > 0 and F_after == 0)
```

기본 deadEnd 비용은 25, FPL 비용은 1.5이며 둘 다 설정 가능하다. 하단 손실은 weight-critical 종류의 기존 최하단 높이 이하에 남는 위치 수로 같은 손실식을 계산한다. 무거운 종류는 알려진 최대 무게의 75% 이상이면서 최소 무게보다 25% 이상 무거운 종류로 분류한다. aspect≥3, 큰 부피 또는 위치 희소성을 형상 난도의 표시로 사용한다.

Lookahead 보상은 `placed/depth − blocked + 0.1·(1−height/maxHeight)`다. Expected는 재고 수량에 비례해 중복 수량을 넘기지 않는 순서를 샘플링하여 평균을 사용한다. Worst-case는 어려운 종류를 먼저/평가 구간 마지막에 두는 두 순서의 최소 보상이다. 이는 모든 가능한 순서에 대한 수학적 최악값이 아니다.

## 7. Dynamic Reservation의 정확한 동작

1. 현재 실제 도착 박스의 후보를 공유 생성기로 만든다. 미입고 박스는 선택 대상으로 전달하지 않는다.
2. 남은 모든 종류에 대해 최대 B개의 위치를 검사해 초기 가능 위치와 Criticality를 계산한다.
3. Criticality 상위 K종을 선택한다. 현재 상태에서 이미 위치가 0개인 종류도 진단에 포함한다.
4. 현재 후보 p를 데이터 복사본에 가상 배치한다.
5. 각 Critical 종류의 기존 위치를 모두 다시 검사하고 새 frontier 위치도 검사해 중복 좌표·크기를 제거한다.
6. 지지·조상 하중·무게 순서·허용 회전·정적 평형·설정된 접근 조건을 통과한 위치만 센다.
7. FPL, 새 `양수→0` 사건, 무거운 종류의 하단 위치 손실을 계산한다. 이미 `0→0`인 상태를 이번 배치가 만든 dead end라고 기록하지 않는다.
8. 현재 품질과 공간 분할 비용을 더한 점수로 현재 후보 하나를 고른다. 후보끼리 같은 예산·같은 재고 정보를 사용한다.
9. 선택한 가상 배치 이후의 보호 위치·before/after 수·점수 성분을 저장한다. 확정 시 실제 current ID와 기존 하드 제약을 다시 검사한다.

각 슬롯은 해당 종류 **한 개**가 들어갈 수 있는 개별 기회다. 서로 겹치는 슬롯도 있으므로 위치 수를 남은 전체 물량의 동시 적재 용량으로 해석하면 안 된다. 자세 대칭은 제거하지만 연속 공간 전체를 세는 것이 아니며 예산에 따른 표본 수다. 새 접촉 경계나 받침이 생기면 위치 수가 증가할 수도 있다.

## 8. MACS와 Dynamic의 차이

MACS는 남는 공간의 형상을 평가하고 Dynamic은 특정 미래 박스가 실제 제약 아래 들어가는지를 평가한다. MACS가 큰 빈 공간을 남겨도 무거운 미래 박스를 지탱할 바닥 자리는 사라질 수 있다. Hybrid는 두 신호를 결합한다.

MACS는 [TAP-Net 원 논문](https://arxiv.org/abs/2009.01469)과 [저자 공개 코드](https://github.com/Juzhan/TAP-Net)의 접근 가능한 공간 보존 아이디어를 참고했다. 여기서는 정확한 convex-space 계산 대신 최대 16×16 압축 skyline의 **위로 열린 빈 직육면체**를 사용한다. 각 격자 셀은 실제 교차 박스의 최고 높이를 취하므로 축 경계를 줄일 때 공간을 과대 계산하지 않고 일부 기회를 놓칠 수 있다. 덮인 내부 구멍은 접근 가능 공간에 포함하지 않는다. TAP-Net 학습 모델은 사용하지 않는다.

## 9. UI 선택·시각화 방법

1. 기존 상단 메뉴의 **미래 공간 6전략 실험**을 선택하거나 `?palletDemo=strategies#pallet`로 연다.
2. **선택 알고리즘**에서 여섯 전략을 고른다. 기존 세 정책도 그대로 남아 있다.
3. **미래 공간 전략 설정**을 펼쳐 K·후보 상한·FPL·Lookahead·가중치·접근 여유를 바꾸고 **설정 적용 · 새 실행**을 누른다.
4. **한 단계** 또는 **자동 적재**로 실행한다. 3D 회전·확대·선택·단면·이력 재생은 기존 기능이다.
5. **미래 공간 디버그**를 켜면 예약 wireframe, Critical 종류, 가능 위치 `before→after`, FPL과 점수 성분이 나타난다. 접근 여유 옵션은 같은 위치 위의 반투명 영역으로 표시한다.
6. **알고리즘 비교**는 순차 투입에서 새 여섯 전략을 같은 시드로 실행한다. 재고 선택에서는 기존 세 정책 비교를 유지한다. 결과는 CSV·JSON으로 저장한다.

전체 재고 모드에서 새 전략을 고르면 같은 박스 세트·제약을 보존한 채 순차 투입으로 전환한다. 반대로 기존 재고 모드를 선택하면 기존 정책으로 돌아간다는 안내를 표시한다. 기존 8대 협업 화면은 별도로 유지된다.

## 10. Benchmark 실행

프로젝트 루트에서:

```powershell
npm run benchmark:strategies
# 기본: 시드 42, 43, 44 × 여섯 전략 = 18회

$env:PALLET_BENCH_EPISODES='100'
$env:PALLET_BENCH_SEED='42'
npm run benchmark:strategies
```

TypeScript API:

```ts
import { runBenchmark, benchmarkCsv } from './src/pallet/strategies/benchmark';
const rows = runBenchmark({
  scenario, settings,
  algorithms: ['strategy-greedy', 'macs', 'dynamic-reservation', 'lookahead'],
  episodes: 3, seeds: [42, 43, 44]
});
const json = JSON.stringify(rows, null, 2);
const csv = benchmarkCsv(rows);
```

JSON에는 입력·설정과 각 실행의 전체 예정 입고 ID/실제 관측 ID가 보존된다. 전체 예정 순서는 **벤치마크 환경에서만** 생성해 검증용으로 저장하며 계획기에는 전달하지 않는다. 중단한 정책의 관측 순서는 같은 예정 순서의 접두사여야 한다.

실패 개수는 실제로 배치 실패한 도착 박스 수, 미처리 수는 중단 뒤 아직 처리하지 않은 수다. 두 값을 따로 기록하며 격리·누락도 기존 지표로 남긴다. 평균/최소 미래 위치 수는 평가한 Critical 종류의 선택된 결정 기준이다. 명시적 부분 재계획 수는 프레임에 기록하고, 기존 입력 파일의 규격 변경은 관측 기록으로 집계한다. 미확정 후보를 클릭한 횟수나 화면 렌더 횟수는 재계획 수가 아니다.

## 11. 테스트 결과

- 최종 단위·회귀: **23파일, 236테스트 통과**.
- 신규 전략 테스트 19개: 동일 박스 여섯 전략 완전 적재, 큰 박스 공간 보존, 긴 박스 난도, 늦은 무거운 박스 하단 보존, 후보 손실 기록, 실제 `1→0`과 큰 비용, 정적 예약의 지속/사용, Greedy·MACS의 미래 정보 독립성, 동일 입고 순서, 가상 수량 보존, 재고 모드 차단, 경계·관통·지지 등 재검사, 접근 여유와 숨은 구멍, 예산 검증, Worst-case 재현성.
- 별도 benchmark 테스트 통과: 3시드 × 6전략, 18회. 이 입력에서는 모든 전략이 항상 전체 적재에 성공하지 않았다. 실패도 삭제하지 않고 기록했다.
- 기존 8대 높이 회귀: **139/192개**, 동시 작동 최대 8대, 전달 27회. 높이 `[1520,1593,1507,1498,1560,1571,1587,1561]` mm로 기존 결과 유지.
- TypeScript 검사와 Vite production build 통과. 기존 큰 Three.js/Rapier 번들에 대한 크기 경고는 남아 있다.
- 로컬 브라우저: 순차 실행, 3D 디버그, 중단 뒤 마지막 판단 유지, 6전략 비교 완료, CSV 다운로드 및 새 진단 열 확인. 브라우저 콘솔 오류 없음.

측정 설정은 C=48, B=8, K=3, Lookahead L=4/S=3/D=2이며 UI 기본 예산과 다르다. 3개의 합성 시드 결과만으로 일반적인 우열을 주장하지 않는다.

| 전략 | seed 42 | seed 43 | seed 44 | 평균 적재 / 18개 |
|---|---:|---:|---:|---:|
| Greedy | 4 | 3 | 1 | 2.67 |
| MACS | 4 | 3 | 1 | 2.67 |
| Tetris Reserved Slot | 6 | 8 | 11 | 8.33 |
| Dynamic Reservation | 14 | 6 | 11 | 10.33 |
| Lookahead | 4 | 6 | 10 | 6.67 |
| Future-Aware Hybrid | 14 | 6 | 11 | 10.33 |

시드 42에서 Dynamic 높이는 1045mm, Hybrid는 같은 14개를 631mm에 적재했다. Critical이 선택되지 않는 종류나 유한 탐색 예산 때문에 조기 중단할 수 있다. 시간·부피·무게중심·지지율·FPL의 원시 측정값은 CSV/JSON을 참고한다.

## 12. 단순화한 물리 조건

축 정렬 직육면체, 균등 내부 질량, 박스별 허용 6자세, 기존 정적 반력·누적 하중·접촉 지지 모델을 사용한다. 종이/플라스틱이라는 이름만으로 무제한 지지력을 부여하지 않으며 입력된 강도와 안전계수를 적용한다. 예제 강도는 실측 인증값이 아니다.

새 예제는 이상적 적재 모드로 시작한다. 기존 그리퍼 모드를 켜면 기존 가반하중·경로 스윕·작업공간 검사가 적용된다. 새 접근 옵션은 슬롯 위 일정 높이와 측면 여유의 수직 AABB proxy일 뿐, 실제 로봇의 전체 관절·흡착·접근 자세 검증이 아니다. 박스 압축·습도·내용물 이동·동적 운반 안정성·장기 크리프는 모델링하지 않는다. Rapier 강체 검증은 사용자가 별도로 실행하는 기존 기능이다.

## 13. 추후 개선

종류별 연속 공간·확정 EMS를 사용한 후보 수 정규화, 겹친 슬롯을 고려한 다중 박스 용량 추정, 실제 운용 데이터로 가중치 보정, adaptive 후보 예산, 여러 후속 정책을 유지하는 beam search, 시간 제한/진척 취소, 실측 압축 강도·파지 가능 면·관절 궤적 모델을 단계적으로 추가할 수 있다. 현재 버전은 이 개선을 이미 검증한 것처럼 표시하지 않는다.
