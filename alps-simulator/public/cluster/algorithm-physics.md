# ALPS Tetris의 알고리즘 기반과 물리 모델

확인일: 2026-10-10. 대상: `alps-simulator` 공통 TypeScript 엔진. 이 문서는 알고리즘과 물리 계산의 출처를 설명하며, 새 성능 평가의 최종 통계는 별도 검증 보고서를 따른다.

**ALPS Tetris는 기존 3차원 적재 휴리스틱의 개념을 조합해 이 프로젝트에 맞게 구현한 배치 정책이다.** 모서리·경계 후보 생성, 낮은 위치 우선, 접촉·빈틈 평가, 잔여 수량으로 만든 짧은 가상 입고 비교, 정적 평형 검사로 구성된다. 완전히 새로운 원천 알고리즘으로 발표할 근거도, 특정 논문의 알고리즘을 그대로 재현했다고 말할 근거도 없다. 프로젝트가 작성한 후보 확장·우선순위·가상 비교 조합은 존재한다. [현재 구현: floorDense.ts 11–201행](../src/engine/floorDense.ts#L11)

**카운팅은 적용되어 있다.** 현재 도착한 박스와 종류별 남은 개수·규격은 알지만 실제 다음 박스의 종류와 미래 순서는 모른다. 다만 잔량을 사용하는 방식은 정책마다 다르다. Tetris는 잔량 비율로 가상 입고를 표본 추출하고, 새 군집 정책은 남아 있는 규격으로 좁은 틈을 평가하되 Tetris의 가상 순서 탐색은 실행하지 않는다. [정보 경계: core.ts 38–52행](../src/engine/core.ts#L38), [Tetris 잔량 활용: floorDense.ts 55–73행·121–162행](../src/engine/floorDense.ts#L55), [군집 정책: clusterPacking.ts 14–41행](../src/engine/clusterPacking.ts#L14)

## 1. ALPS, Tetris, 군집 정책을 구분하기

기존 프로젝트에서 **ALPS는 중앙 대분류와 팔레트 선택·적재·재분배를 연결한 시스템 명칭**이다. 기존 검증은 복수 팔레트에 배송 분류별로 배정하고 출고 시 차단 상자를 먼저 옮기는 실험이었다. 이번 화면은 그중 **한 팔레트에 적재할 때 동일 SKU를 얼마나 모으고 직접 겹쳐 쌓는가**에 초점을 맞춘 정책 비교다. 따라서 이번 정책의 결과를 ALPS 전체 시스템 도입 효과로 확대하면 안 된다. 확인한 자료에서 ALPS 영문 약어의 공식 풀네임은 확정하지 않았다. [기존 ALPS 정의·정책·재분배: ALPS-validation.md 1–36행](../../pallet-height-lab/docs/ALPS-validation.md#L1)

| 명칭 | 실제 코드·버전 | 하는 일 | 출처에 관해 말할 수 있는 범위 |
|---|---|---|---|
| ALPS Tetris · 바닥 밀집 | `floor-dense`, `floor-dense/2` | 가장 낮은 자리·신규 공극을 먼저 고르고 같은 조건의 후보에 짧은 가상 잔량 비교 적용 | 기존 적재 개념을 조합한 프로젝트 정책 |
| ALPS 군집 · 층 우선 | `cluster-floor`, 공통 `cluster-packing/1` | 바닥·신규 공극을 우선한 뒤 낮은 250 mm 높이 구간에서 동일 SKU 접촉 선호 | 이번 프로젝트의 명시적 군집 휴리스틱 |
| ALPS 군집 · 연결 우선 | `cluster-layer`, 공통 `cluster-packing/1` | 바닥·신규 공극을 우선한 뒤 상단 전체 후보에서 동일 SKU 접촉 선호 | 이번 선정 대상인 군집 정책. Tetris의 별칭이 아님 |
| UCT MCTS | `mcts`, 별도 `mcts.ts` | 잔량 시나리오에서 UCT 선택·확장·rollout·역전파 | 별도 control-room 탐색을 공통 엔진에 논리 이식 |
| 분산 적재 · 대조군 | `dispersed`, 공통 `cluster-packing/1` | 같은 물리 조건에서 동일 SKU 접촉을 적게 만드는 쪽 선호 | 인위적 음성 대조군. 실제 현장의 보편적인 기존 알고리즘이라는 뜻이 아님 |

화면 이름과 정책 ID는 [config.ts 2–9행](../src/engine/config.ts#L2), 실제 군집 조건은 [clusterPacking.ts 9–23행](../src/engine/clusterPacking.ts#L9)에 있다. `cluster-layer`라는 ID와 “층 우선”이라는 한국어 이름을 연결하면 반대로 해석하게 된다. **실제 식에서 `cluster-layer`의 높이 구간 항은 0이고, 다른 군집 모드의 항은 `floor(z / 250)`**이다. 버전 문자열도 현재 `cluster-layer/1`이 아니라 `cluster-packing/1`이다.

## 2. 실제로 참고한 것과 이번에 설명을 위해 대조한 문헌

| 구성 요소 | 기존 문서에서 확인한 참고 이력 | 이번 코드의 구현과 차이 |
|---|---|---|
| 모서리·극점 후보 개념 | Crainic, Perboli, Tadei의 *Extreme Point-Based Heuristics for Three-Dimensional Bin Packing* (2008). 기존 문서가 직접 참고라고 명시 | 기존 박스 모서리·팔레트 경계의 x/y를 교차 조합하고 위에서 내려놓는 착지 높이를 계산한다. 논문의 EP 투영 목록 갱신·EP-FFD/EP-BFD를 그대로 재현한 것은 아님 |
| 정적 힘·모멘트 평형 개념 | Galrão Ramos 등, *A container loading algorithm with static mechanical equilibrium stability constraints* (2016). 기존 문서는 공개 초록 참고를 명시 | 수직 비음수 반력의 자체 계산기를 사용한다. 논문의 BRKGA·maximal spaces·층 구성 전체를 구현했다고 볼 수 없음 |
| 종류 집합은 알지만 도착 순서는 모르는 문제 | Wang·Hauser의 *Robot Packing with Known Items and Nondeterministic Arrival Order*. 기존 `adaptive` 개선 문서에 참고 이력 존재 | 현재 Tetris의 직접 구현 계보로 연결할 증거는 없음. 문제 설정을 설명하는 관련 문헌이며, 현재 정책은 모든 입고 순서에서의 적재 가능성을 인증하는 QOP가 아님 |
| UCT 탐색 | 공통 엔진 `provenance.json`은 별도 `alps-control-room/engine/search.js`에서의 논리 이식을 기록 | UCT의 표준 원형은 Kocsis·Szepesvári (2006). 이 원논문은 이번 설명에서 대조한 문헌이며 당시 개발자가 직접 참고했다는 이력까지 확인한 것은 아님 |
| Tetris라는 이름·정책 우선순위·군집 순위 | 현재 코드가 직접 정의 | 학습한 테트리스 게임 AI나 특정 공개 패킹 라이브러리를 가져왔다는 근거 없음. 이름은 적재 방식의 비유 |

참고 이력의 1차 근거는 [IDEAL-PALLET-ALGORITHM.md 15–37행](../../pallet-height-lab/docs/IDEAL-PALLET-ALGORITHM.md#L15), [ORDERING-IMPROVEMENTS.md 19–48행](../../pallet-height-lab/docs/ORDERING-IMPROVEMENTS.md#L19), [vendor/provenance.json](../src/engine/vendor/provenance.json)이다. `vendor`는 기존 `pallet-height-lab`의 순수 TypeScript 의존성을 복사하고 원본 경로·SHA-256을 기록한 부분이고, 새 Tetris·군집 정책과 UCT 어댑터는 그 밖에 있다. 기록된 provenance는 파일 계보를 보여주며 외부 논문 성능의 재현을 입증하지 않는다.

이번 문서 작성 시 provenance에 기록된 복사 파일 59개의 SHA-256을 현재 파일과 대조했으며 모두 일치했다. 이는 복사본의 파일 동일성을 확인한 것이고 원논문의 알고리즘 재현이나 물리 정확성을 증명한 것은 아니다.

대조한 1차 문헌:

- Crainic·Perboli·Tadei: [저널 DOI와 초록](https://pubsonline.informs.org/doi/10.1287/ijoc.1070.0250), [저자 연구기관의 공개 원고, CIRRELT-2007-41](https://www.cirrelt.ca/documentstravail/cirrelt-2007-41.pdf). EP는 물건을 넣을 후보 지점을 효율적으로 정의하는 개념이다. 현재 코드는 이 개념의 상부 투입 변형이며 논문의 좌표 생성 규칙과 동일하지 않다.
- Galrão Ramos·Oliveira·Gonçalves·Lopes: [DOI 10.1016/j.trb.2016.06.003](https://doi.org/10.1016/j.trb.2016.06.003), [저자 연구기관 저장소의 초록](https://repositorio.inesctec.pt/items/61984702-d453-48c9-9615-d97801a6b10b). 원 연구는 강체의 정적 평형을 이용한 적재 조건을 제안한다. 현재 자체 반력 구현의 정확한 수치 방법을 원논문에서 가져왔다고 주장하지 않는다.
- Wang·Hauser: [저자 공개 TASE 원고](https://motion.cs.illinois.edu/papers/TASE2020-Wang-RobotPackingNondeterministic-preprint.pdf), [DOI](https://doi.org/10.1109/TASE.2020.3024291), [저자 프로젝트](https://hauserlab.web.illinois.edu/packing/index.html). 사전 물품 집합과 불확정 도착 순서를 다루는 NDOP/QOP 연구다. 원고·DOI의 2020 표기와 [권·호의 2021 발행](https://experts.illinois.edu/en/publications/robot-packing-with-known-items-and-nondeterministic-arrival-order/)을 구분한다.
- Kocsis·Szepesvári: [저자 공개 *Bandit based Monte-Carlo Planning* 원고](https://sites.ualberta.ca/~szepesva/papers/ecml06.pdf), [DOI 10.1007/11871842_29](https://doi.org/10.1007/11871842_29). UCT를 설명하는 원논문이다. 현재 Tetris 자체를 MCTS라고 부르는 근거는 되지 않는다.

문헌 일부 출판사 원문은 접근 제한이 있어 저자·소속기관의 공개 원고 또는 초록으로 확인했다. 원문을 확인하지 못한 수치 방법까지 구현 일치로 단정하지 않았다.

## 3. 박스 하나가 도착했을 때 실제 계산 순서

1. 현재 박스의 SKU·치수·무게·허용 방향을 받고, 그 박스를 미도착 수량에서 차감한다. 이미 놓은 박스의 좌표는 고정한다.
2. 허용 방향별로 팔레트 경계와 기존 박스 모서리에 맞춘 후보를 만든다. 서로 다른 박스의 x와 y 경계도 교차 조합한다.
3. 각 후보의 착지 높이는 그 footprint 아래에 겹치는 기존 박스의 최고 상단이다. 빈 지붕 아래로 순간 이동해서 넣는 후보는 만들지 않는다.
4. 경계·높이·겹침·지지 등을 먼저 거르고, 유효 후보에 정적 평형·허용 하중·그리퍼 경로 검사를 한다.
5. 정책별 순위로 현재 최선의 유효 후보를 발행한다. Tetris는 시간이 남으면 짧은 가상 잔량 비교를 추가한다.
6. 감독 Worker는 시간 안에 받은 후보만 저장하며, 확정할 때 별도 검증을 다시 거친다. 후보를 찾지 못하면 미적재로 기록한다.

근거: [core.ts 46–76행](../src/engine/core.ts#L46), [frontier.ts 17–46행](../src/engine/vendor/pallet/frontier.ts#L17), [geometry.ts 42–57행](../src/engine/vendor/pallet/geometry.ts#L42), [constraints.ts 46–102행](../src/engine/vendor/pallet/constraints.ts#L46), [supervisor.ts 40–67행](../src/engine/supervisor.ts#L40).

### Tetris의 우선순위는 가중 평균이 아니다

현재 상태에서는 아래 항목을 **사전식으로** 비교한다. 앞 항목이 다르면 뒤 항목이 아무리 좋아도 역전하지 못한다.

`낮은 바닥 z → 적은 신규 수직 공극 → 작은 좁은 옆 틈 추정 → 같은 상단 높이의 인접 접촉 → 박스 옆면·팔레트 경계 접촉 → 작은 XY 점유 경계 사각형 → 낮은 전체 상단 → 작은 수평 무게중심 편심 → 낮은 무게중심 → y/x/방향 동률 처리`

여기서 **신규 수직 공극**은 새 박스 footprint를 기존 모서리로 분할하고 `셀 면적 × max(0, 새 박스 바닥 z − 기존 셀 최고 높이)`를 합한 정확한 기하량이다. 기존 상자 밑에 이미 묻혀 있던 공극은 제외한다. **좁은 옆 틈**은 남은 박스들의 허용 방향 중 최소 폭·깊이보다 좁은 측면 띠를 평가하는 추정 항이다. 모서리를 중복 계산할 수 있고, 실제로 영구히 사용할 수 없는 공간의 정확한 면적은 아니다. 팔레트 경계 접촉은 밀집 선호이며 물리적인 벽의 지지력이 아니다. [floorDense.ts 19–83행](../src/engine/floorDense.ts#L19)

Tetris는 기본 후보 외에 방향·모드별 최대 128개 후보와 경계·균형 중심·인접 좌표 중간점을 추가로 검사한다. 일반 정책의 기본 후보 상한은 48개이므로 **모든 정책의 후보 개수가 같은 통제 실험은 아니다.** 실제 입고 정보·하드 제약·전체 시간 기한은 공유한다. [floorDense.ts 86–103행·192–201행](../src/engine/floorDense.ts#L86), [config.ts 11–14행](../src/engine/config.ts#L11)

### Tetris의 가상 입고 비교

현재 상태에서 **바닥 z와 신규 공극이 똑같이 최소인 후보**만 최대 6개 남긴다. 모든 후보에 동일한 가상 입고 3개, 최대 미래 4박스를 적용한다. 각 후속 단계의 후보 상한은 24개이며 동일 물리 검사를 다시 한다. 모든 후보의 평가가 끝난 시나리오만 합산하고, `추가 적재 부피 최대 → 추가 개수 최대 → 예측 신규 공극 최소 → 현재 상태 순위`로 선택한다. 따라서 최종 선택은 위의 현재 상태 우선순위만으로 설명하면 불완전하다. [floorDense.ts 117–162행·166–200행](../src/engine/floorDense.ts#L117)

이 방식은 **소수 후보의 짧은 표본 rollout**이다. UCT 점수로 탐색 트리를 확장·역전파하는 별도 MCTS와 다르다. UCT MCTS는 [mcts.ts 65–90행](../src/engine/mcts.ts#L65)에서 방문 횟수·평균 보상·탐색 보너스를 사용한다. 기본 MCTS 한도는 깊이 3·시나리오 3·최대 384회다. 이 한도는 Tetris의 4·3·6과 혼동하면 안 된다. [config.ts 14행](../src/engine/config.ts#L14)

## 4. 카운팅은 미래를 미리 보는 것인가

아니다. 예를 들어 현재 관측 박스가 A이고 그 박스를 차감한 미도착 수량이 A 3개·B 2개라면, 가상 추출에서 `P(A)=3/5`, `P(B)=2/5`로 시작한다. A를 하나 가상 추출하면 가상 잔량만 A 2개·B 2개가 된다. **실제 다음 박스가 무엇인지는 확인하지 않는다.** 실제 입고 난수와 탐색 난수는 분리되어 있고, 탐색 난수 시드는 공통으로 91473이다. [floorDense.ts 124–130행](../src/engine/floorDense.ts#L124), [core.ts 38–49행](../src/engine/core.ts#L38)

이 확률은 남은 개별 박스를 균등하게 뽑는 `random-draw`라는 시뮬레이션 가정과 맞는다. 현장 입고가 특정 SKU끼리 연속되는 구조라면 잔량 비율만으로 다음 도착 확률을 설명하기 어렵다. 그 경우 과거 관측에 기반한 입고 모델을 별도로 검증해야 한다. [실제 random-draw: environment.ts 30–36행](../src/engine/vendor/pallet/environment.ts#L30)

수량 용어도 구분한다. `remaining`은 **미도착 수량**이며 현재 관측은 이미 제외된다. 현재 박스가 적재에 실패해도 미도착으로 되돌리지 않는다. `미적재`와 `미처리`는 별도이며 최종 수량 보존은 `적재 + 미적재 + 미처리 = 전체 입고`로 검사한다. 따라서 카운터를 “아직 팔레트에 없는 모든 박스”라고 부르면 의미가 달라진다. [core.ts 48–49행·67–74행](../src/engine/core.ts#L48)

실험 결과 파일에는 전체 입고와 단계별 기록이 있어 화면에서 적재 과정을 재생할 수 있다. 이는 측정 후 저장된 결과의 시각 재생이며, 배치를 결정할 때 계획기가 그 전체 기록을 받는다는 뜻이 아니다. 실제 계획 호출의 `DecisionRequest`에는 현재 박스·잔량·확정 배치만 투영된다. [입력 구성과 결과 저장: core.ts 49행·67–76행](../src/engine/core.ts#L49)

군집 정책도 현재 박스와 잔량을 입력받지만, 동일 SKU가 몇 개 남았는지에 비례하여 구역을 예약하거나 3개 미래 순서를 샘플링하는 정책은 아니다. `denseRank`의 좁은 틈 항에서 **어떤 규격이 아직 남아 있는가**를 사용한다. “모든 ALPS 정책이 잔량 비례 예측을 한다”는 설명은 틀리다. [clusterPacking.ts 14–39행](../src/engine/clusterPacking.ts#L14)

## 5. 군집과 수직 겹침은 무엇을 계산하는가

현재 군집 휴리스틱은 현재 박스의 전체 표면적 `2(wd+wh+dh)`로 동일 SKU와 맞닿는 면적을 정규화한다. 같은 SKU를 먼저, 같은 상품 부문을 그다음 선호한다. 이후 낮은 높이·좁은 틈·전체 접촉 등으로 동률을 푼다. `dispersed`는 이 접촉 항의 부호를 반대로 하되 경계·지지·하중·그리퍼 제약을 동일하게 지킨다. [clusterPacking.ts 14–23행](../src/engine/clusterPacking.ts#L14)

보고 지표는 후보 순위의 분모와 다르다. 최종 **동일 SKU 접촉률**은 `동일 SKU끼리 공유한 면적 / 모든 박스끼리 공유한 면적`, **동일 SKU 수직 겹침률**은 `동일 SKU끼리 직접 맞닿은 수평 면적 / 모든 직접 맞닿은 수평 면적`이다. 공중으로 떨어진 채 XY 투영만 겹친 박스는 수직 접촉으로 세지 않는다. 동일 SKU 연결 성분도 실제 면 접촉을 기준으로 한다. 접촉이 없으면 접촉률은 0%나 100%가 아니라 `null`이다. [clustering.ts 1–34행](../src/metrics/clustering.ts#L1)

기존 실험실의 원본 `retailScenario`는 S1/S2, S3/S4, S5/S6에 같은 **부문** 색을 사용한다. 새 3개 시연 화면은 이를 **SKU별 6개 서로 다른 색**으로 바꾸므로, 새 화면에서는 같은 색이 같은 SKU를 뜻한다. 지표 계산은 색이 아닌 `typeId`를 기준으로 한다. [원본 부문 색상](../src/engine/vendor/pallet/capacity/experiment.ts#L48), [새 화면의 SKU 색상](../src/cluster/Presentation.tsx#L11)

## 6. 현재 물리 모델의 범위

### 기하·지지

직육면체의 좌표는 mm, 질량은 kg이다. 현재 유통 입력은 팔레트 1200×1000 mm, 기본 최고 높이 1200 mm이며 박스는 상하 고정·수평 0/90° 회전이다. 각 박스 내부 질량을 균일하게 가정한다. 경계 돌출·관통·허용 높이 초과·금지 방향은 탈락시킨다. 지지율은 아래 접촉 면적의 합을 박스 바닥 면적으로 나눈 값이고, 현재 입력의 최소 지지율은 **85%**다. 자체 중심의 수평 투영도 지지 접촉의 볼록껍질 안에 있어야 한다. [retailScenario: capacity/experiment.ts 44–63행](../src/engine/vendor/pallet/capacity/experiment.ts#L44), [geometry.ts 13–34행](../src/engine/vendor/pallet/geometry.ts#L13), [constraints.ts 49–66행](../src/engine/vendor/pallet/constraints.ts#L49)

기존 문서의 다른 실험에서 사용한 95% 지지율·0.15 g·안전계수 1.25를 이번 입력의 값으로 복사하면 틀린 설명이 된다.

### 정적 반력과 누적 하중

박스 자기 무게와 위에서 전달된 하중을 합쳐 각 접촉면에서 압축 방향의 수직 반력을 찾는다. 중력가속도 g를 공통으로 나눈 kg 상당 단위로 다음 조건을 계산한다.

```text
Σ R_i = M
Σ R_i x_i = M · c_x
Σ R_i y_i = M · c_y
R_i ≥ 0
```

`M`은 해당 받침면으로 전달되는 총질량, `c_x, c_y`는 전달 모멘트에 대응하는 합력 위치다. 접촉 사각형의 네 모서리를 반력 표본점으로 만들고 면적 비례 압력 분담을 기준으로 3×3 선형계를 푼다. 음수 반력 표본점을 제외하고 재계산하며, 특이해지면 볼록 지지경계 내 삼각형의 비음수 무게 분담으로 평형 가능한 해를 찾는다. [equilibrium.ts 6–31행](../src/engine/vendor/pallet/equilibrium.ts#L6)

위에서 아래로 반력 비중과 작용점을 전달하고, 새 박스를 놓을 때 이전 접촉면의 반력·하중도 다시 계산한다. 좌표는 이동하지 않는다. 이는 수직력과 수평 모멘트를 보존하는 **자체 정적 근사**이며, 실제 압력 분포를 유일하게 결정하거나 포장재 변형을 계산하는 해석은 아니다. [equilibrium.ts 33–39행](../src/engine/vendor/pallet/equilibrium.ts#L33), [constraints.ts 65–80행](../src/engine/vendor/pallet/constraints.ts#L65)

### 무게중심·전도 여유

각 박스의 모든 상부 전달 하중을 포함해 합력 중심을 구하고, 지지 접촉의 볼록껍질 경계까지 최소 거리를 계산한다. 필요한 여유는 다음과 같다.

```text
required = max(지지의 짧은 폭 × minMarginRatio,
               접촉면 위 합력 중심 높이 × lateralAccelerationG)
reserve = 실제 최소 경계 거리 − required
```

현재 입력은 `minMarginRatio=.05`, `lateralAccelerationG=0`이므로 **5% 기하 여유만 적용**한다. 횡가속도·운송 흔들림을 통과했다는 뜻은 아니다. 독립 지지 연결 성분의 `높이 / 받침의 짧은 폭`도 산출하지만 현재 `slendernessMode='score'`여서 이 비율 상한만으로 배치를 금지하지 않는다. 옆면 접촉은 밴드나 결속력이 아니다. [stability.ts 16–37행](../src/engine/vendor/pallet/stability.ts#L16), [현재 설정: capacity/experiment.ts 59행](../src/engine/vendor/pallet/capacity/experiment.ts#L59)

화면의 전체 화물 무게중심은 `Σ(m_i c_i) / Σm_i`이고 팔레트 자체 질량은 제외한다. 중심에 가깝다는 지표와 모든 층의 정적 평형 통과는 별개의 검사다. [core.ts 20–22행](../src/engine/core.ts#L20)

### 강도·무거운 상자 순서

현재 여섯 SKU의 허용 상부 하중은 85/24/55/40/45/30 kg의 **합성 예제값**이다. 안전계수 1.2로 나눈 용량에 누적 상재하중을 비교한다. 일반식은 `허용 용량 = 기준 허용 하중 × strengthFactor / loadSafetyFactor`이며 미확인 강도는 검증된 값으로 취급하지 않는다. [capacity/experiment.ts 42–59행](../src/engine/vendor/pallet/capacity/experiment.ts#L42), [materials.ts 4–15행](../src/engine/vendor/pallet/materials.ts#L4)

멘토 협의로 꺼 둔 것은 **상자가 아래 상자보다 무거우면 금지하는 단순 자중 순서 규칙**이다. 아래 상자의 누적 허용 하중·지지·평형 검사는 살아 있다. “무거운 상자를 위에 놓아도 아무 제한이 없다”는 뜻이 아니다. [constraints.ts 67–80행](../src/engine/vendor/pallet/constraints.ts#L67), [core.ts 15행](../src/engine/core.ts#L15)

### 그리퍼·로봇

현재 입력은 `robotMode='gripper'`다. 그리퍼 180×160×160 mm, 공구 질량 8 kg, 공구 포함 가반 38 kg, 도달 반경 최대 2700 mm와 직육면체 작업공간을 사용한다. 안전 높이로 올려 수평 이동하고 내려놓는 경로에서 박스·그리퍼의 swept AABB와 회전 포락을 검사한다. 이 검사는 경로 간섭에 대한 보수적 근사다. [capacity/experiment.ts 57–62행](../src/engine/vendor/pallet/capacity/experiment.ts#L57), [constraints.ts 22–44행·83–102행](../src/engine/vendor/pallet/constraints.ts#L22)

전체 관절 IK, 모든 로봇 링크 충돌, 관절 토크·속도·가속도, 흡착·파지 안정성은 현재 연결되어 있지 않다. 경로 시간 항도 거리·설정 속도·회전 속도·집기/놓기 시간으로 만든 근사다. 현재 비교의 10/12초 로봇 목표 주기는 별도 가정이며 이 경로 계산이 실측 10/12초를 인증하지 않는다. [RobotValidator 확장점: constraints.ts 101–102행](../src/engine/vendor/pallet/constraints.ts#L101), [시간 가정: core.ts 11–18행·63–68행](../src/engine/core.ts#L11)

### Rapier와 현재 실행의 관계

현재 `alps-simulator`는 자체 TypeScript 기하·정적 검사기를 실행한다. 패키지 의존성에 Rapier가 없고, 현재 확정 경로도 Rapier를 호출하지 않는다. 이전 `pallet-height-lab`의 Rapier 강체 복제 실험은 **별도 수동 검증 기능**이며 이번 벤치마크가 전부 Rapier 동적 검증을 받았다는 뜻은 아니다. [현재 package.json](../package.json), [현재 확정 경로: core.ts 55–66행](../src/engine/core.ts#L55), [기존 BENCHMARK.md 3행](../../pallet-height-lab/docs/BENCHMARK.md#L3), [기존 강체 실험: HIGH-STACKING.md 44–46행](../../pallet-height-lab/docs/HIGH-STACKING.md#L44)

[Rapier 공식 문서](https://rapier.rs/docs/)는 강체 충돌·힘 등을 계산하는 물리 엔진의 기능을 설명한다. 그 엔진의 기능 목록과 현재 앱이 실제 수행한 검증을 동일하게 취급하면 안 된다. 현 실행은 시간 적분한 충돌·낙하·회전·마찰 동역학, 골판지 압축·크리프·습도, 내용물 이동, 운송 진동을 계산하지 않는다. 입력 마찰계수 .45가 있다는 사실만으로 동적 마찰 검증을 했다고 표현할 수 없다. [현재 정적 계산: equilibrium.ts](../src/engine/vendor/pallet/equilibrium.ts), [stability.ts](../src/engine/vendor/pallet/stability.ts)

## 7. 시간 제한과 결과 해석

계산 가용 시간은 `로봇 목표 주기 − 인지 지연 − 확정·전송 여유`다. 기본 10초·인지 0초·여유 1초이면 9초다. 감독자는 Worker 준비 후 실제 왕복 시간을 재고 늦은 결과·다른 결정 ID를 거른다. 시간 제한에 걸리면 그 전에 전달되어 검증된 후보만 사용한다. 최종 확정 검사까지 전체 주기 안에 들어가야 적재된다. [config.ts 11–24행](../src/engine/config.ts#L11), [supervisor.ts 15–67행](../src/engine/supervisor.ts#L15), [core.ts 55–68행](../src/engine/core.ts#L55)

한정된 좌표 후보·탐색 깊이·표본 수·시간 안에서 좋은 배치를 찾는 것이 목표다. 실패는 **검토한 후보에서 유효 위치를 못 찾았다는 뜻**이고, 연속 공간 전체에 적재 해가 없다는 증명은 아니다. 모든 바닥 면적을 사용하거나 모든 빈틈을 없애는 보장도 없다. “가장 효율적”은 입력·지표·가중치·비교 정책·선정/확인 시드를 명시한 실험 범위 안의 표현이어야 한다. [frontier.ts 35–46행](../src/engine/vendor/pallet/frontier.ts#L35), [floorDense.ts 164–201행](../src/engine/floorDense.ts#L164), [clusterPacking.ts 25–41행](../src/engine/clusterPacking.ts#L25)

## 8. 발표에서 사용할 수 있는 설명

> “ALPS의 적재 모듈은 모서리 기반 후보 생성과 온라인 3차원 패킹 휴리스틱을 바탕으로 합니다. 다음 입고 순서는 모르지만 SKU별 잔여 수량을 알고, Tetris 정책은 그 수량으로 짧은 가상 입고를 만들어 비교합니다. 이번 군집 정책은 바닥 활용과 신규 공극을 먼저 지키면서 같은 SKU의 직접 접촉과 수직 연결을 선호하도록 구성했습니다. 모든 배치는 공통 기하·지지·정적 반력·허용 상부 하중·그리퍼 경로 근사를 검사합니다. 결과는 이 입력과 비교 지표에 대한 시뮬레이션이며 전역 최적성이나 실제 운송·로봇 동역학의 검증을 뜻하지 않습니다.”

출처 슬라이드에는 **극점 후보 개념: Crainic 등(2008), 정적 평형 개념: Galrão Ramos 등(2016), 관련 문제 설정: Wang·Hauser(2020/2021), 별도 UCT 비교군의 원형: Kocsis·Szepesvári(2006)**로 구분하면 된다. 프로젝트 자체 구현은 Tetris 우선순위·후보 확장·잔량 표본 비교·군집 접촉 순위라고 설명할 수 있다. Wang·Hauser QOP 재현, 모든 순서 적재 보장, Rapier 기반 현재 동역학 검증, 현장 실측 재분배 시간으로 표현할 근거는 현재 없다.
