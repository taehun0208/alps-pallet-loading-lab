# ALPS 군집 재현 가이드

이 문서는 팀원이 현재 구현을 동일 입력·제약·실행 예산으로 재현하기 위한 명세다. 기준은 완료된 [evaluation-v2/freeze.json](benchmark-1000/evaluation-v2/freeze.json)과 그 [source-snapshot](benchmark-1000/evaluation-v2/source-snapshot)이다. 기존 결과를 수정하지 않고 새 출력 디렉터리에 재실행한다. 별도의 대규모·고높이 팀원 실험은 이 명세에 포함하지 않는다.

## 실행 명세 한눈에

| 항목 | 값 |
|---|---|
| 팔레트 | x 폭 1200mm × y 깊이 1000mm, z 높이 제한 1200mm |
| 로봇·입력 | 바닥 설치 로봇 1대, 팔레트 1개, 현재 박스만 처리, 임시 대기 버퍼 없음 |
| 조건 | `h1200-n30-s6`, `h1200-n30-s8`; 모두 총 30개 |
| 입고 표본 | 조건별 서로 다른 seed 100개 및 서로 다른 SKU 순서 100개 |
| 비교 정책 | `blb`, `capacity-compact`, `strategy-greedy`, `lookahead`, `future-hybrid`, `floor-dense`, `cluster-layer` |
| 총 trial | 2조건 × 100순서 × 7정책 = 1,400회; MCTS 미포함 |
| 병렬성 | 공유 머신 4작업, shard당 순서 25개, 각 순서의 정책 순서 회전 |
| 시간 | cycle 10초, 인지 지연 0초, reserve 1초, 결정 탐색 9000ms |
| 기본 후보 설정 | `maxCandidates:48`; ALPS 두 정책은 추가 후보 생성에서 128로 확장 |
| 기록 환경 | Node v24.14.1, Apple M5, darwin/arm64 |
| 기준 signature | `8bab669522ba33fdce1f082fe36fc5b8ff2f7f4b4e4dc100bba05912e2928feb` |

`quantityPerSku:5`는 config 값이다. 사용자 시나리오가 있으면 재고 수량을 이 값으로 덮어쓰지 않는다. 8 SKU 조건의 수량은 아래의 4/3 분배를 그대로 사용한다. 실제 실행에서는 config의 `maxHeightMm`가 시나리오 최대 높이에 다시 적용된다.

## 1. 재고와 입고 순서

치수는 회전 전 `w,d,h`(mm), 질량과 상부 허용하중 입력은 kg다. 강도는 실험용 합성값이며 제조사 인증값이 아니다.

| SKU | 이름 | w | d | h | 질량 | maxLoadKg | 6 SKU 수량 | 8 SKU 수량 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| S1 | 생수 | 400 | 300 | 280 | 12 | 85 | 5 | 4 |
| S2 | 과자 | 500 | 340 | 250 | 3 | 24 | 5 | 4 |
| S3 | 세제 | 320 | 240 | 320 | 8 | 55 | 5 | 4 |
| S4 | 생활용품 | 400 | 300 | 220 | 4 | 40 | 5 | 4 |
| S5 | 헤어케어 | 300 | 250 | 240 | 6 | 45 | 5 | 4 |
| S6 | 스킨케어 | 250 | 200 | 200 | 4 | 30 | 5 | 4 |
| S7 | 음료 | 380 | 260 | 230 | 7 | 50 | 제외 | 3 |
| S8 | 주방용품 | 450 | 300 | 210 | 5 | 40 | 제외 | 3 |

모든 타입은 `orientations:[0,90]`, `handling:"upright"`, `material:"paper"`, `friction:0.45`, `maxLoadSource:"synthetic"`다. 90도는 XY 회전으로 w/d를 바꾸며 h는 유지한다. 눕히기·세우기는 허용되지 않는다. `strengthFactor`가 없으므로 1이며 실제 모델 허용하중은 `maxLoadKg / 1.2`다. 예를 들어 S1은 약 70.833kg, S2는 20kg이다. 상부 질량은 지지 관계를 따라 전달되므로 단순히 위 박스 한 개 질량만 비교하지 않는다.

[workloads.ts](../src/benchmark1000/workloads.ts)가 재고를 만들고 [ArrivalEnvironment](../src/engine/vendor/pallet/environment.ts)가 남은 **개별 박스** 중 하나를 균등 추출해 제거한다. SKU별 동일 확률 추출이 아니다. 난수 구현은 [rng.ts](../src/engine/vendor/pallet/rng.ts)의 `rng`를 그대로 사용한다.

- 6 SKU 평가 seed: `460000000`~`460000099`.
- 8 SKU 평가 seed: `460100000`~`460100099`.
- 각 조건의 실제 `rejectedDuplicates`는 0이다. 일반 생성기는 seed를 증가시키면서 `sequence.join(',')` 중복을 발견하면 버리고 다음 seed를 시도한다. 향후 다른 n/재고에서는 단순 연속 범위를 가정하지 말고 manifest의 orders를 사용한다.
- 100개는 **입고 순서** 100개다. 조건 안의 박스 크기·수량은 동일하며 100가지 무작위 형상이 아니다.
- 동일 조건·seed의 7개 정책은 동일 입력 fingerprint와 SKU sequence를 사용한다. 순서 변경이나 불리한 박스 재추출을 허용하지 않는다.

## 2. 군집 정책의 정확한 선택 순서

기준 구현은 [clusterPacking.ts](../src/engine/clusterPacking.ts)의 `clusterRank`/`searchCluster`다. 벡터를 사전식으로 **최소화**한다. 앞 항목의 차이가 있으면 뒤 항목으로 보상하지 않는다. 비교 허용오차는 `abs(delta)>1e-7`이며 나머지는 동률로 본다. 아래 점수들을 가중합으로 바꾸면 다른 알고리즘이다.

`cluster-layer`의 실제 벡터 순서는 다음과 같다.

| 순번 | 최소화 항목 | 의미 |
|---:|---|---|
| 1 | `z < 1e-5 ? 0 : 1` | 유효 후보 사이에서 바닥 배치 우선 |
| 2 | `newColumnVoid` | 이번 박스로 새로 덮는 국소 공기 부피 최소 |
| 3 | `0` | cluster-layer에서는 층 밴드 구분 없음 |
| 4 | `-sameSkuFaceArea / boxSurfaceArea` | 같은 SKU와 맞닿는 면적 최대 |
| 5 | `-sameDepartmentFaceArea / boxSurfaceArea` | 같은 부서와 맞닿는 면적 최대 |
| 6 | `z` | 현재 박스 바닥 높이 최소 |
| 7 | `narrowSideStrips` | 작은 잔여 박스가 들어가기 어려운 측면 띠 proxy 최소 |
| 8 | `-totalBoxFaceArea` | SKU 불문 박스 간 실제 접촉 면적 최대 |
| 9 | `-sameTopSideContactLength` | 옆 박스와 상단 높이가 같은 측면 접촉 길이 최대 |
| 10 | `-sideAndPalletEdgeArea` | 박스 측면·팔레트 경계 접촉 proxy 최대 |
| 11 | `occupiedXYBoundingArea` | 화물 전체 XY 바운딩 사각형 면적 최소 |
| 12 | `globalTop` | 전체 적재 최고 높이 최소 |
| 13 | `horizontalCargoCoGOffset` | 화물 CoG의 팔레트 중심 수평 편차 최소 |
| 14 | `cargoCoGZ` | 화물 CoG 높이 최소 |
| 15~17 | `y`, `x`, `orientation===0?0:1` | 결정적 동률 해소 |

면적 정규화 분모는 현재 회전된 박스 전체 표면적 `2*(w*d+w*h+d*h)`다. 비교 후보의 동일 SKU/부서 접촉을 이 분모로 나눈다. 이것은 결과 리포트의 `sameSkuContact = 전체 동일 SKU 접촉 면적 / 전체 박스 접촉 면적`과 **다른 값**이다.

[contact()](../src/metrics/clustering.ts)는 좌우·앞뒤·상하의 **실제 접촉 면적**을 모두 합한다. 접촉 판정 면 간격은 `<1e-5mm`, 나머지 두 축은 겹침 길이를 곱한다. 공간을 사이에 둔 근접, XY 투영만 겹치는 공중 관계, 모서리·점 접촉은 면적 보상이 없다. 팔레트 경계는 same-SKU 접촉에 포함되지 않는다. 부서는 `floor((SKU번호-1)/2)`이므로 S1/S2, S3/S4, S5/S6, S7/S8이 각각 묶인다.

**해석:** 바닥 후보가 있으면 유효 후보 중 바닥이 먼저다. 상부 후보끼리는 새 공극이 같을 때 같은 SKU 접촉이 현재 z보다 먼저이므로 더 높은 연결 배치를 선택할 수 있다. 그러나 위로만 쌓으라는 강제 조건은 없다. 같은 SKU의 옆면 접촉도 보상하며, 유효한 지지·하중·접근 제약을 먼저 통과해야 한다. `cluster-floor`는 별도 정책으로 250mm z 밴드를 SKU 접촉보다 먼저 비교하지만 이번 7정책 평가에는 포함되지 않았다.

## 3. Tetris와 후보 탐색의 차이

[floorDense.ts](../src/engine/floorDense.ts)의 `floor-dense`는 `z → 새 공극 → 측면 띠 → 같은 상단 높이 측면 접촉 → 측면/팔레트 경계 접촉 → XY 범위 → 전체 높이 → 수평 CoG → CoG 높이 → y/x/회전` 순서다. **같은 SKU 자체를 우선하는 항목은 없다.**

두 ALPS 정책은 [planner.ts](../src/engine/planner.ts)에서 BLB 기본 후보와 먼저 검증한 incumbent를 확보한 다음 다음 영역을 확장한다.

1. 기본 설정의 후보 예산 48.
2. `maxCandidates:128`로 일반 후보와 support-target 후보를 각각 생성.
3. frontier 정렬 좌표, 균형/중앙 좌표, 인접 좌표 중점으로 `extraOrigins` 생성.
4. 중복 제거 후 기하 검사를 거쳐 [inspectConstraints](../src/engine/vendor/pallet/constraints.ts)로 검증하고 유효 후보만 비교.

후보 생성은 [defaultCapacityConfig](../src/engine/vendor/pallet/capacity/experiment.ts)와 [ONLINE_SEARCH](../src/engine/vendor/pallet/types.ts)를 기반으로 한다. 실효 설정은 `candidateMode:"frontier"`, `policy:"online"`, `portfolio:false`, `topK:4`, `samples:2`, `depth:2`, `reserveProbes:4`, `virtualCandidates:8`, 기본 `inventoryMode:"geometry"`다. core가 `maxCandidates:48`, `temporaryBuffer:false`, `plannerSeed:91473`를 적용한다. cluster가 반환용 features를 계산할 때는 `inventoryMode:"none"`를 사용하며 features 가중합이 cluster 사전식 rank를 대체하지 않는다. 나머지 비교 정책까지 독립 포팅한다면 해당 기본 가중치와 strategy 설정도 그대로 가져와야 한다.

**128은 전체 방문 후보 수의 최종 상한이 아니다.** 두 후보 목록과 추가 origins가 합쳐지고 중복을 제거하므로 실제 방문량은 달라진다. cluster의 중복 키는 위치+크기이며 회전값을 별도로 넣지 않는다. 이 입력에서는 0/90 회전의 치수가 달라 구분되지만, 정사각형·방향별 강도 입력으로 확장하면 원 구현의 키 의미도 확인해야 한다.

`floor-dense`에는 추가 rollout이 있다. 최소 z·최소 새 공극의 공통 root 집합에서 최대 6개, 깊이 최대 4, 잔량 기반 합성 시나리오 3개를 평가한다. 한 시나리오가 모든 root에서 완전히 끝난 경우만 합산하며 예측 추가 부피 → 개수 → 공극 → dense rank로 선택한다. rollout 후보 예산은 24다. **cluster-layer에는 이 rollout이 없고 현재 후보의 사전식 비교만 수행한다.**

[core.ts](../src/engine/core.ts)는 current를 잔량에서 차감한 뒤 current·알려진 SKU 사양·remaining counts·기배치 상태만 전달한다. 실제 앞으로 들어올 순서, arrival seed, 숨은 queue는 planner에 전달하지 않는다. planner 난수 seed는 별도로 고정한 `91473`다. Tetris의 예측은 잔량에서 추출한 가상 미래이며 실제 미래 순서를 보는 것이 아니다.

`newColumnVoid`는 현재 박스 밑면 범위를 정확한 XY 셀로 나누고, 이전 국소 최고 높이보다 박스 바닥이 높은 부분의 `면적*(z-beforeTop)`만 합산한다. 기존 박스 아래에 이미 있던 공극을 다시 벌점으로 세지 않는다. 최종 전체 `columnVoid`와 구분한다.

## 4. 공통 유효성 제약

아래 수치는 freeze의 실제 입력이다. 모든 정책에 공통이며 군집 선호가 제약을 완화하지 않는다.

| 제약 | 실제 설정 |
|---|---|
| 경계/충돌 | 팔레트 밖·z<0·높이>1200 금지, 박스 간 비겹침, horizontalGap=0mm |
| 지지 | 밑면 지지율 ≥0.85, 접촉 높이 허용오차 0.5mm, CoG 지지 검사와 평형 검사 |
| 하중 | 위의 합성 maxLoad 입력, loadSafetyFactor=1.2, 누적 상부 하중 검사 |
| 무거운 것 위 금지 규칙 | `heavyRule:"off"`; 허용 지지하중 검사는 계속 적용 |
| 안정성 | maxSlenderness=2, slendernessMode="score", minMarginRatio=0.05, lateralAccelerationG=0 |
| 자세 | 모든 SKU upright, 허용 XY 회전 0/90만 |
| 그리퍼 | 폭180·깊이160·높이160mm, 질량8kg, payload38kg, margin5mm, lift180mm |
| 이동 proxy | speed650mm/s, pick0.7s, place0.45s, rotationSpeed90deg/s |
| 작업공간 | x[-1400,1800], y[-600,1600], z≤2600mm |
| TCP 도달 반경 | base(-700,500), min0·max2700mm |
| standingHeight | enabled=false; maxRiseMm100은 비활성 필드 |

가반 검사는 `박스 질량 + 그리퍼 질량 ≤38kg`다. 그리퍼와 화물의 swept 경로·작업공간·TCP 반경을 검사하지만 실제 로봇의 관절 IK/전체 링크 모델은 아니다. 접촉 점수의 1e-5mm와 **지지 모델**의 0.5mm 허용오차를 혼동하지 않는다. slendernessMode="score"이므로 maxSlenderness=2를 단순한 높이 비율 하드 컷으로 구현하지 않는다.

## 5. 결정 루프와 마감 프레임

```text
freeze에서 condition inventory와 order seed를 선택
arrival RNG로 30개 관측을 재현하되 planner에 queue/seed를 전달하지 않음
for current in arrivals:
    remaining[current.sku] -= 1
    input = 현재 박스 + 전체 SKU 사양 + remaining + placements + 공통 제약
    supervisor가 worker 준비 후 9000ms wall-clock watchdog 시작
    BLB 초기 유효 incumbent 확보
    cluster-layer이면:
        기본 후보 + 확장 후보 + extraOrigins를 생성/중복 제거
        각 후보가 geometricFeasible 및 inspectConstraints를 통과할 때:
            rank = 위의 17항목 벡터
            이전 rank보다 사전식으로 작으면 다시 검증하여 incumbent 게시
        마감 전 최종 incumbent 반환
    외부 supervisor는 마감 후 도착 메시지를 폐기
    core는 별도로 commit validation 수행
    유효 후보이며 인지+elapsed+validation ≤10000ms이면 배치
    아니면 현재 박스를 거부로 남기고 다음 관측 진행
```

정확한 watchdog은 [supervisor.ts](../src/engine/supervisor.ts), commit 검사는 [validation.ts](../src/engine/validation.ts)와 core에 있다. 마감 시에는 이전에 제시간에 받은 검증된 incumbent만 fallback으로 사용할 수 있고 worker를 종료한다. worker 로딩은 결정시간에서 제외된다. 첫 결정 자체는 측정에 포함된다.

10초 cycle은 로봇 작업의 **가정/목표값**이다. 9초는 박스당 탐색 예산이며 trial 전체 제한이 아니다. 다음 계획과 직전 로봇 운동의 겹침을 시간 모델로 기록하지만 실제 인지·컨베이어·거부 제거·관절 운동의 end-to-end 10초 실측 보장은 아니다. 공유 머신 병렬 경합은 지연뿐 아니라 탐색량·결과에도 영향을 줄 수 있다.

## 6. JSON 입력 예

아래는 8 SKU의 첫 평가 seed에 대한 **설정/시나리오 예**다. 독립 구현이나 `runTrial(config,algorithm,seed,{scenario,planDecision})` 어댑터 입력으로 사용할 수 있다. CLI가 이 JSON을 직접 읽는다는 뜻은 아니다. 실제 runner는 workload 함수로 시나리오를 만든다. 표시용 color만 생략했다.

```json
{
  "algorithm": "cluster-layer",
  "seed": 460100000,
  "config": {
    "cycleSeconds": 10,
    "recognitionDelaySeconds": 0,
    "reserveSeconds": 1,
    "maxHeightMm": 1200,
    "quantityPerSku": 5,
    "searchBudgetMs": null,
    "maxCandidates": 48,
    "mcts": {
      "depth": 3,
      "scenarios": 3,
      "maxIterations": 384
    }
  },
  "scenario": {
    "version": 1,
    "units": {
      "length": "mm",
      "weight": "kg",
      "time": "s"
    },
    "id": "h1200-n30-s8",
    "name": "합성 입력 30개 / 8 SKU",
    "pallet": {
      "width": 1200,
      "depth": 1000,
      "maxHeight": 1200,
      "robotLayout": {
        "count": 1,
        "architecture": "floor",
        "floorCount": 1
      }
    },
    "types": [
      {
        "id": "S1",
        "name": "생수",
        "size": {
          "w": 400,
          "d": 300,
          "h": 280
        },
        "weight": 12,
        "maxLoadKg": 85,
        "maxLoadSource": "synthetic",
        "quantity": 4,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S2",
        "name": "과자",
        "size": {
          "w": 500,
          "d": 340,
          "h": 250
        },
        "weight": 3,
        "maxLoadKg": 24,
        "maxLoadSource": "synthetic",
        "quantity": 4,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S3",
        "name": "세제",
        "size": {
          "w": 320,
          "d": 240,
          "h": 320
        },
        "weight": 8,
        "maxLoadKg": 55,
        "maxLoadSource": "synthetic",
        "quantity": 4,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S4",
        "name": "생활용품",
        "size": {
          "w": 400,
          "d": 300,
          "h": 220
        },
        "weight": 4,
        "maxLoadKg": 40,
        "maxLoadSource": "synthetic",
        "quantity": 4,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S5",
        "name": "헤어케어",
        "size": {
          "w": 300,
          "d": 250,
          "h": 240
        },
        "weight": 6,
        "maxLoadKg": 45,
        "maxLoadSource": "synthetic",
        "quantity": 4,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S6",
        "name": "스킨케어",
        "size": {
          "w": 250,
          "d": 200,
          "h": 200
        },
        "weight": 4,
        "maxLoadKg": 30,
        "maxLoadSource": "synthetic",
        "quantity": 4,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S7",
        "name": "음료",
        "size": {
          "w": 380,
          "d": 260,
          "h": 230
        },
        "weight": 7,
        "maxLoadKg": 50,
        "maxLoadSource": "synthetic",
        "quantity": 3,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      },
      {
        "id": "S8",
        "name": "주방용품",
        "size": {
          "w": 450,
          "d": 300,
          "h": 210
        },
        "weight": 5,
        "maxLoadKg": 40,
        "maxLoadSource": "synthetic",
        "quantity": 3,
        "orientations": [
          0,
          90
        ],
        "handling": "upright",
        "material": "paper",
        "friction": 0.45
      }
    ],
    "constraints": {
      "robotMode": "gripper",
      "supportRatio": 0.85,
      "contactTolerance": 0.5,
      "horizontalGap": 0,
      "heavyRule": "off",
      "stability": {
        "maxSlenderness": 2,
        "minMarginRatio": 0.05,
        "lateralAccelerationG": 0,
        "loadSafetyFactor": 1.2,
        "slendernessMode": "score"
      },
      "gripper": {
        "width": 180,
        "depth": 160,
        "height": 160,
        "mass": 8,
        "payload": 38,
        "margin": 5,
        "lift": 180,
        "speed": 650,
        "pickSeconds": 0.7,
        "placeSeconds": 0.45,
        "rotationSpeed": 90
      },
      "workspace": {
        "xMin": -1400,
        "xMax": 1800,
        "yMin": -600,
        "yMax": 1600,
        "zMax": 2600
      },
      "reach": {
        "baseX": -700,
        "baseY": 500,
        "minRadius": 0,
        "maxRadius": 2700
      },
      "standingHeight": {
        "enabled": false,
        "maxRiseMm": 100
      }
    },
    "arrival": {
      "seed": 0,
      "pattern": "random-draw"
    },
    "events": [],
    "supplyMode": "arrival"
  }
}
```

6 SKU 입력으로 바꿀 때 S7/S8을 제거하고 S1~S6 quantity를 각각 5로 바꾸며 id/name 및 seed를 6 SKU 조건에 맞춘다. 외부 재현은 freeze의 첫 `orders[0].sequence`와 생성한 순서가 완전히 같은지 먼저 확인한다.

## 7. 팀원 실행 절차

저장소의 `alps-simulator` 루트에서 실행한다. 이번 문서 작성에서는 아래 벤치마크를 실행하지 않았다. `benchmark-1000-pool.py --help`만 호출해 옵션을 확인했다. Node 러너에는 안전한 `--help` 분기가 없으므로 `node scripts/benchmark-1000.mjs --help`를 도움말 확인 용도로 실행하지 않는다.

```bash
npm ci
npm test
npm run build

./node_modules/.bin/esbuild scripts/benchmark-worker.ts --bundle --platform=node --format=esm --outfile=scripts/benchmark-worker.mjs
./node_modules/.bin/esbuild scripts/benchmark-1000.ts --bundle --platform=node --format=esm --outfile=scripts/benchmark-1000.mjs

python3 scripts/benchmark-1000-pool.py --help
python3 scripts/benchmark-1000-pool.py --out docs/benchmark-1000/reproduction-v1 --n 100 --concurrency 4 --batch-size 25 --prepare-only
python3 scripts/benchmark-1000-pool.py --out docs/benchmark-1000/reproduction-v1 --n 100 --concurrency 4 --batch-size 25
python3 scripts/benchmark-1000-audit.py --root docs/benchmark-1000/reproduction-v1 --output docs/benchmark-1000/reproduction-v1/audit
```

재실행 명령은 **새 계산을 시작하고 파일을 만든다**. 기존 evaluation-v2에 새 소스/설정을 섞지 않는다. `--prepare-only`도 freeze·source snapshot·pool plan을 만드는 쓰기 동작이다. 같은 새 디렉터리 재호출은 signature가 같을 때만 재개하며, n·병렬성·소스가 바뀌면 또 다른 이름을 쓴다. `--pilot`는 별도 seed 영역과 플래그를 쓰므로 본 평가와 합치지 않는다. 이 명령에는 Claude/API 접근이 필요하지 않다.

esbuild는 잠긴 개발 의존성 트리에서 제공되는 로컬 실행 파일을 사용한다. 서로 다른 빌드 도구/버전에서 번들 바이트가 달라질 수 있으므로 재생성된 signature가 기존과 반드시 같다고 가정하지 않는다. 바이트 단위 역사 재현이 필요하면 freeze의 source-snapshot과 기록 환경을 기준으로 확인한다. 주어진 소스·난수 순서는 재현 가능하지만 벽시계 마감·OS 경합 때문에 지연과 경우에 따라 배치 결과까지 모든 머신에서 비트 단위 동일하다고 보장하지 않는다.

완료 조건은 audit의 expectedTrials=1400, auditedTrials=1400, missingTrials=0, auditErrors=[]와 complete=true다. 7정책 각각 조건별 100개인지, seed·SKU 순서 중복 없음, 짝 입력 일치, 수량 보존, 거부·오류·마감 초과의 누락 없음도 확인한다. 중단되면 목표 100개를 완료했다고 보고하지 않는다.

## 8. 결과를 읽는 순서

기본 채택 판단은 **배치 개수와 부피 → 실제 사용 높이의 밀도·공극 → 시간/제약 → SKU 추가 가치** 순서다.

- 공급부피 수용률: `placedVolume/suppliedVolume`.
- full-height fill: `placedVolume/(1200*1000*1200)`.
- envelopeFill: `placedVolume/(1200*1000*usedHeight)`; 각 trial 비율을 먼저 계산한 뒤 평균한다.
- columnVoid: 각 XY 셀의 국소 최상단 밑 전체 부피에서 박스 부피를 뺀 값. 위쪽 열린 공기는 제외한다. trapped/irrecoverable void의 증명은 아니다.
- sameSkuContact: 실제 박스 면 접촉 중 같은 SKU 비율, 접촉이 없으면 null; 보조 점수에서는 0 기여.

낮은 columnVoid와 높은 envelope 밀도는 같은 목적이 아니다. 군집이 높은 기둥을 만들면 columnVoid가 낮아도 외곽 전체 밀도가 낮을 수 있다. 바닥 coverage는 2D 지표이므로 3D 틈 없음의 증거가 아니다. 작은 적재량이 밀도만 높게 보일 수도 있으므로 개수·부피를 반드시 함께 제시한다.

[score-plan.json](benchmark-1000/score-plan.json)의 `60*acceptance + 15*floor + 15*sameSkuContact + 10*deadlineCompliance`는 사전 지정된 보조 기술 점수다. deadlineCompliance는 `1-deadlineMisses/decisions.length`이며 관측 결정이 0개면 0이다. 이 점수는 산업 표준·채택 순위·밀도 최적성 판정이 아니다. 원래 1차 통계 비교는 Tetris 대 다른 6정책 × 두 조건의 12개 수용률 짝비교, Bonferroni 동시 95% CI와 사전 실질 기준 +2%p다. 군집 대 Compact나 밀도 순위를 이 검정의 확증 결과로 주장하지 않는다.

## 출처와 적용 한계

정확한 수량/치수/제약/seed는 freeze의 두 manifests를, 알고리즘은 링크한 코드와 frozen snapshot을 확인했다. score 설정은 snapshot에 동결된 [score-plan](benchmark-1000/evaluation-v2/source-snapshot/docs/benchmark-1000/score-plan.json)과 일치한다. 완료 결과와 독립 감사는 [audit/summary.md](benchmark-1000/evaluation-v2/audit/summary.md)에 있다.

확실하지 않은 것은 합성 강도의 현실성, 실제 센서/로봇 시간, 관절/전체 링크 경로, 운송 안정성이다. 공통 엔진의 검증을 통과했다는 사실이 이것들을 실물 검증한 것은 아니다. 유한 후보·잔량 예측·사전식 휴리스틱이므로 전역 최적성이나 특정 논문의 정확한 재현을 주장하지 않는다.
