# ALPS 군집의 계산식: 쉬운 설명과 실제 구현

ALPS 군집은 **먼저 놓아도 되는 후보를 검사하고, 통과한 후보 중 바닥·공극·같은 SKU 접촉의 우선순위로 하나를 고르는 방식**이다. 물리 검사는 합격/불합격 조건이고, 군집 선호는 그다음의 선택 기준이다. 후보의 점수가 높아도 지지·하중·접근 검사를 통과하지 못하면 배치하지 않는다.

이 문서는 현재 `cluster-layer`와 완료된 [evaluation-v2/freeze.json](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/docs/benchmark-1000/evaluation-v2/freeze.json)의 설정을 설명한다. 정확한 재고·재현 명령은 [군집 재현 가이드](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/docs/ALPS-%EA%B5%B0%EC%A7%91-%EC%9E%AC%ED%98%84-%EA%B0%80%EC%9D%B4%EB%93%9C.md)를 참고한다. 아래 작은 숫자 예제는 모두 **계산 이해를 위한 설명용 예제**이며 추가 실험 결과가 아니다.

## 1. 단위와 기준 설정

| 표현 | 단위·뜻 |
|---|---|
| x,y,z / w,d,h | mm; 박스 왼쪽 앞 아래 좌표 / 가로·깊이·높이 |
| 면적 A | mm² |
| 부피 V | mm³; 1L = 1,000,000mm³ |
| 질량 m, 코드의 weight/loadAbove | kg |
| 힘 F | N; 코드의 kg 하중값과 구별 |
| share, 지지율, 접촉 비율 | 0~1의 무차원 비율 |

실제 평가 팔레트는 **1200×1000mm, 높이 제한 1200mm**다. 모든 박스는 upright이며 XY 회전 0/90도만 허용한다. 지지율은 **85%**, 안전계수는 **1.2**, `heavyRule:"off"`다. `heavyRule`을 끈 것은 위 박스가 아래 박스보다 무겁다는 이유만으로 거절하는 규칙을 끈 것이며, 상부 허용하중 검사까지 끈 것이 아니다.

코드는 정적 하중을 kg 질량 상당량으로 전파한다. 물리적인 수직 힘으로 읽을 때는 `F = m·g`(N)로 바꿀 수 있지만, 엔진은 이 계산에 g를 곱하지 않는다. 같은 중력 아래 반력의 비율과 하중 비교에서 g가 공통으로 약분되는 모델이다. `loadAbove:20`을 20N이라고 읽으면 안 된다.

## 2. 경계와 겹침: 박스가 공간 안에 실제로 들어가는가

박스 b의 범위는 `[x,x+w] × [y,y+d] × [z,z+h]`다. 팔레트 폭 W=1200, 깊이 D=1000, 높이 H=1200에서 기본 조건은 다음과 같다.

```text
0 ≤ x,  0 ≤ y,  0 ≤ z
x+w ≤ W,  y+d ≤ D,  z+h ≤ H
```

코드는 일부 경계 비교에 `EPS=1e-6`의 수치 허용오차를 사용한다. 두 박스의 x,y,z 구간이 **세 축 모두에서 양의 길이로 겹치면** 충돌이다. 면이 맞닿는 것은 체적 겹침이 아니다. 평가의 `horizontalGap=0`이므로 추가 수평 간격을 요구하지 않는다.

설명용 예: x=900에 폭400mm 박스를 놓으면 오른쪽 끝이1300mm여서 폭1200mm 밖으로 나간다. x=800이면 오른쪽 끝1200mm로 경계에 맞는다. 별도로 그리퍼의 접근 경로까지 유효해야 실제 후보가 된다.

출처: [geometry.ts의 intersects/overlapRect](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/geometry.ts), [constraints.ts의 inspectConstraints](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/constraints.ts).

## 3. 밑면 지지율 85%: 바닥을 얼마나 받쳐 주는가

상부 박스 밑면과 아래 박스 윗면의 높이 차이가 **0.5mm 이내**이고, XY가 겹치는 부분을 지지 접촉으로 잡는다. 접촉 사각형의 면적을 합산한다.

```text
A_bottom = w·d                         [mm²]
A_support = Σ(접촉 사각형 면적)         [mm²]
supportRatio = A_support / A_bottom    [무차원]
통과 조건: supportRatio ≥ 0.85         (작은 EPS 허용오차 적용)
```

팔레트 바닥 z=0에 놓인 박스의 지지율은1로 처리한다. 실제 유효 배치에서는 아래 박스들이 서로 겹치지 않으므로 지지 면적도 체적 겹침 없이 계산된다.

설명용 예: 밑면400×300=120,000mm²에서 받치는 면적이102,000mm²면102,000/120,000=0.85로 **면적 조건**을 충족한다.100,000mm²면83.33%로 미달한다.

**85%만 넘으면 끝이 아니다.** 현재 박스의 무게중심 투영이 지지 접촉 꼭짓점들의 볼록껍질 안에 있어야 하고, 누적 하중의 평형과 여유 거리 검사도 통과해야 한다. 볼록껍질은 받침 점들을 감싼 외곽 다각형이며 실제 틈을 채웠다는 뜻은 아니다.

출처: [geometry.ts의 contactsFor/centerSupported](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/geometry.ts), [constraints.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/constraints.ts). 이 평가에는 BoxSpec별 별도 지지율 입력이 없으므로 공통85%를 사용한다.

## 4. 직계 하중과 누적 하중: 아래 박스가 실제로 받는 무게

바로 위 박스의 질량만 보는 것은 직계 하중이다. 실제 모델은 **그 박스 위에서 내려온 하중까지** 아래로 전파한다.

상부 박스 j가 아래 박스 i에 주는 지지 비율을 s(j→i)라 하면, 현재 평가의 일반 상자 경로는 다음과 같다.

```text
L_i = Σ_j s(j→i) · (m_j + L_j)      [kg]
Σ_i s(j→i) = 1,   s(j→i) ≥ 0
```

여기서 L_i는 i 위에 실린 질량 상당량(`loadAbove`)이다. i 자신의 질량 m_i는 **i의 상부 허용하중 검사에는 더하지 않지만**, i가 그 아래 박스로 전달할 때는 `m_i+L_i`에 포함된다. 위에서 아래 순서로 계산한다.

설명용 예: 아래 A 위에 B 8kg, 그 위에 C 6kg이 전부 실리면 A의 직계 위 박스는 B지만 A의 누적 상부 하중은14kg이다. A 자신의 질량이3kg이면 그 아래 지지체에는 총17kg이 전달된다. 받침이 둘이면 평형에서 구한 share로 나뉜다.

이 평가에서는 `packaging` 객체가 없는 일반 상자를 사용한다. 해당 경로는 평형 계산으로 보정한 `contact.share`를 이용한다. 다른 BoxSpec 경로의 면적 비율 처리를 이번 평가의 동작과 섞지 않는다.

출처: [geometry.ts의 calculateLoads](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/geometry.ts), [equilibrium.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/equilibrium.ts), [constraints.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/constraints.ts).

## 5. 상부 허용하중과 안전계수1.2

현재 SKU들은 제조사 시험값 대신 합성 `maxLoadKg`를 가지고 있다. 일반 상자의 유효 허용하중은 다음과 같다.

```text
C_effective = C_reference · strengthFactor / loadSafetyFactor   [kg]
현재: strengthFactor 기본1, loadSafetyFactor=1.2
하중 통과 조건: L_i ≤ C_effective (+EPS)
loadRatio = L_i / C_effective                                 [무차원]
```

reference는 방향별 입력값이 있으면 그것을 먼저 쓰고, 없으면 박스의 maxLoadKg, 그것도 없으면 재질의 예제값을 사용한다. 이번 입력은 모든 SKU에 maxLoadKg가 있으므로 재질 기본20kg로 덮어쓰지 않는다.

설명용 예: S2의 입력 maxLoadKg=24kg이면 유효값은24/1.2=20kg이다. 위에서 내려오는 하중14kg은 하중 조건만 보면 통과하고22kg은 한도를 초과해 거절된다. 무거운 박스가 더 가벼운 박스 위에 있다는 사실만으로 거절하지 않으며 **이 유효 용량**을 검사한다.

옆면이 같은 SKU와 닿아도 끈·접착제·벽의 지지력으로 간주하지 않는다. 군집 접촉이 하중 용량을 늘려주지 않는다.

출처: [materials.ts의 materialInfo](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/materials.ts), [constraints.ts의 overloaded 검사](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/constraints.ts).

## 6. 무게중심과 정적 평형: 받침에 무게를 나눌 수 있는가

### 화물 전체의 무게중심

현재 평가에서는 각 상자 내부 질량이 균일하다고 가정해 기하 중심을 질량 중심으로 쓴다. 예를 들어 x축은 다음과 같다.

```text
c_ix = x_i + w_i/2                              [mm]
CoG_x = Σ_i(m_i·c_ix) / Σ_i m_i                 [mm]
CoG_y, CoG_z도 같은 방식
수평 중심 편차 = sqrt((CoG_x-W/2)²+(CoG_y-D/2)²) [mm]
```

설명용 예: 중심x=100mm인10kg와 중심x=400mm인5kg를 합치면 `(10·100+5·400)/15=200mm`다. 좌표의 단순 평균250mm가 아니다. 평가 CoG는 화물만 포함하며 팔레트 질량은 제외한다.

출처: [core.ts의 trialMetrics](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/core.ts), [quality.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/metrics/quality.ts). 일반 상자의 중심 정의는 [packaging/spec.ts의 massCenter](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/packaging/spec.ts)에서 확인할 수 있다.

### 지지 면에서의 평형

[정적 평형 solver](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/equilibrium.ts)는 각 접촉 사각형의 네 꼭짓점을 반력 후보점 q_k로 사용한다. 해당 박스의 자기 무게와 위에서 내려온 하중의 합성 중심을 `(c_x,c_y)`라 할 때 다음 조건을 만족하는 비음수 비율 a_k를 찾는다.

```text
a_k ≥ 0
Σ_k a_k = 1
Σ_k a_k·q_kx = c_x
Σ_k a_k·q_ky = c_y
```

첫 식은 받침이 박스를 잡아당기는 힘을 만들지 못한다는 뜻이다. 나머지는 전체 수직 하중과 x/y 방향 모멘트의 평형이다. 힘으로 표현하면 `R_k = M·g·a_k`(N)이지만, 엔진은 a_k와 질량 상당량으로 계산한다.

초기 비율은 접촉 면적에 비례한 균일 압력 기준 `r_k=A_contact/(4·A_total)`이다. solver는 그 기준에서 가능한 한 작은 변화를 구하고, 음수 반력이 필요하면 해당 점을 제외해 다시 푼다. 특이한 경우에는 볼록껍질 삼각형의 비율로 가능한 해를 찾는다. 최종 중심 잔차가1e-5mm보다 작아야 인정한다. 가능한 비음수 해가 없으면 후보를 거절한다.

설명용으로 받침 위치가x=0과100mm 두 점뿐이고 합성 중심이75mm라면 비율은25%/75%다. 전체20kg이면 질량 상당량5kg/15kg로 나뉜다. **실제 코드는 두 점 예제가 아니라 각 접촉 사각형의 네 꼭짓점**을 사용한다. 면적이 같다고 항상50%/50% 하중이 되는 것은 아니다.

하중을 아래로 보낼 때 수직 하중 share와 반력 작용점(`forcePoint`)을 함께 전파한다. 따라서 각 접촉면의 누적 합성 중심과 화물 전체의 단순 CoG를 같은 값으로 간주하지 않는다.

### 가장자리 여유 거리

[stability.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/stability.ts)는 각 지지 평면에서 누적 합성 중심과 지지 외곽 다각형의 가장 가까운 변 사이 거리 margin을 구한다.

```text
required = max(min(지지폭,지지깊이)·minMarginRatio,
               max(0,합성중심높이-지지평면높이)·lateralAccelerationG) [mm]
reserve = margin - required                                          [mm]
통과: reserve ≥ 0 (EPS 허용오차)
```

현재는 minMarginRatio=0.05, lateralAccelerationG=0이므로 두 번째 항은0이다. 설명용으로 지지 폭200mm·깊이100mm면 최소 필요 여유는5mm다. margin6mm는 이 조건을 충족하고4mm는 미달한다.

`maxSlenderness:2`도 입력에 있지만 `slendernessMode:"score"`이므로 현재 경로에서는 높이/받침 폭이2를 넘었다는 이유만으로 하드 거절하지 않는다. 옆면 접촉은 구조적 묶음으로 처리하지 않으며, 연결된 기둥은 상하 **지지 관계**로 구분한다.

## 7. 마찰은 어디까지 구현되어 있는가

모든 평가 SKU에 `friction:0.45`가 기록되어 있고 재질 프로필도 마찰값을 반환한다. 그러나 **현재 군집 후보의 constraints → equilibrium → stability 검사 경로에서는 이 값을 이용한 마찰력·미끄럼 한계 계산이 없다.** 수평 가속도 설정도 이번에는0이다.

코드에 PhysicsSettings/PhysicsPose 타입과 기본값이 있다는 사실만으로 동적 물리 시뮬레이션을 수행했다고 해석하지 않는다. 현재 src의 실행 경로에서 마찰·충격·진동·동적 붕괴를 적분하는 물리 엔진을 호출하지 않는다. 따라서 "마찰계수0.45로 운송 중 미끄럼 안전성을 검증했다"고 말할 수 없다. 이 문서는 구현되지 않은 마찰 공식을 실제 합격 기준으로 추가하지 않는다.

출처: [materials.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/materials.ts), [types.ts의 PhysicsSettings](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/types.ts), [constraints.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/constraints.ts), [planner.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/planner.ts). [quality.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/metrics/quality.ts)의 `dynamicVibrationResistance`도 null이다.

## 8. 로봇 가반·접근 검사: 운반할 수 있는 근사 경로인가

현재 가반 조건은 다음과 같다.

```text
박스 질량 + 그리퍼 질량 ≤ payload
현재 그리퍼8kg, payload38kg → 박스에 사용할 수 있는 질량 여유30kg
```

설명용으로 박스12kg이면12+8=20kg로 가반 조건을 충족한다. 이것만으로 도달성·충돌까지 통과하는 것은 아니다.

코드는 집기 → 올리기 → XY 이동 → 내려놓기 → 이탈/복귀의 경로를 만든다. 그리퍼180×160×160mm, margin5mm, lift180mm, speed650mm/s, 회전90deg/s를 사용한다. 각 경로 구간에서 그리퍼와 운반 박스가 쓸고 지나가는 축정렬 공간과 기존 박스의 충돌을 검사한다. 회전 중에는 `w|cosθ|+d|sinθ|` 형태의 회전 외곽 폭 최대값을 이용한다.

[robotReach.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/robotReach.ts)는 TCP의 수평 경로가 base(-700,500) 기준 반경0~2700mm의 고리 안에 있는지 검사한다. 선분의 가장 가까운 점과 두 끝점 중 먼 거리를 확인한다. 작업공간은x[-1400,1800], y[-600,1600], z≤2600mm다. **로봇 관절각·IK·팔 전체 링크 형상을 푸는 검사는 아니다.**

경로 proxy의 구간 시간은 아래처럼 계산한다.

```text
t_segment = max(이동거리/speed, 회전각차/rotationSpeed) + 해당 정지시간 [s]
```

이 경로 시간과 benchmark의 cycle10초는 다른 값이다. [core.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/core.ts)는 승인된 로봇 운동 시간을 cycle 설정으로 모델링하고, 실제 로봇 시간으로 경로 proxy를 측정한 것이 아니다. 결정 탐색은 `10-0-1=9초`, commit은 `인지+탐색경과+별도검증 ≤10초` 조건으로 검사한다. 인지0초·reserve1초도 가정값이다.

출처: [constraints.ts의 gripperPath/swept](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/vendor/pallet/constraints.ts), [supervisor.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/supervisor.ts), [config.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/config.ts).

## 9. 공극과 3차원 밀도: 빈 공간을 어떤 뜻으로 세는가

### 새로 덮는 공극: 후보 선택용

현재 박스 밑면을 XY 셀로 나누고, 그전 국소 최고 높이 h_old보다 박스 바닥 z가 높은 부분을 적분한다.

```text
newVoid = Σ_cell A_cell · max(0,z-h_old(cell))   [mm³]
```

설명용으로10,000mm² 셀에서 바닥과 이전 윗면 사이가20mm라면 새 공극은200,000mm³=0.2L다. 이전 박스 아래에 이미 있던 빈 공간을 다시 이 항목에 더하지 않는다. z가 바닥이면0이다.

출처: [floorDense.ts의 newColumnVoid](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/floorDense.ts).

### 전체 column void: 결과 설명용

```text
V_boxes = Σ_i w_i·d_i·h_i                        [mm³]
V_column = Σ_cell A_cell·h_top(cell)              [mm³]
columnVoid = max(0,V_column-V_boxes)              [mm³]
```

각 XY 위치에서 가장 높은 박스 윗면 아래만 센다. 국소 윗면 위의 열린 공기는 제외한다. 그래서 높은 군집 기둥 주변에 넓게 열린 공간이 남아도 columnVoid가 작을 수 있다. 이것은 갇힌 공극·다시는 못 쓰는 공간·접근 불가능 공간을 판별하는 알고리즘이 아니다.

### full-height fill과 envelope 밀도

```text
usedHeight = max_i(z_i+h_i)                                  [mm]
fullHeightFill = V_boxes / (W·D·H_limit)                      [비율]
envelopeFill = V_boxes / (W·D·usedHeight)                     [비율]
envelopeVoid = W·D·usedHeight - V_boxes                       [mm³]
supplyAcceptance = V_boxes / V_supplied                      [비율]
```

설명용으로 부피720L, 사용 높이1000mm이면1200×1000×1000mm³=1200L 외곽에서 envelopeFill은60%다. 높이 제한1200mm 전체1440L 기준 fill은50%다. 공급800L라면 acceptance는90%다. 세 비율은 서로 다른 질문에 답한다.

작게 적재하면 낮은 높이 때문에 밀도만 좋아 보일 수 있다. 따라서 **배치 개수·부피를 먼저 확인하고 밀도·공극을 같이 읽는다.** 결과 평균도 각 trial의 비율을 먼저 계산해 평균하며 평균 부피/평균 높이로 바꾸지 않는다.

출처: [quality.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/metrics/quality.ts), [core.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/core.ts).

## 10. 같은 SKU 접촉: 실제로 맞닿은 면을 보상한다

두 박스의 축별 겹침 길이를 아래처럼 정의한다.

```text
O_x = max(0,min(x_a+w_a,x_b+w_b)-max(x_a,x_b)) [mm]
O_y, O_z도 동일
A_contact = I_x·O_y·O_z + I_y·O_x·O_z + I_z·O_x·O_y [mm²]
```

I_x는 x방향 양면의 좌표 차이가1e-5mm 미만일 때1, 아니면0이다. y/z도 같다. 즉 **옆면과 위아래 면을 모두** 세며 비접촉 근접은 점수가 없다. 선·점 접촉도 면적0이다. 지지 높이 허용오차0.5mm와 군집의 면 접촉 판정1e-5mm는 서로 다른 조건이다.

현재 후보 b의 같은 SKU 접촉 점수는 다음과 같다.

```text
A_same = Σ_(other.typeId==b.typeId) A_contact(b,other) [mm²]
A_surface = 2·(w·d+w·h+d·h)                           [mm²]
p_same = A_same/A_surface                            [비율]
```

설명용으로400×300×200mm 박스의 전체 표면적은520,000mm²다. 같은 SKU 옆면80,000mm²와 바닥면120,000mm²가 접촉하면 p_same=200,000/520,000≈0.3846이다. 같은 SKU가 가까워도 사이에 공기가 있으면0이다.

리포트의 `sameSkuContact`는 분모가 다르다. 배치 전체의 **같은 SKU 면 접촉 합 / 모든 박스 간 면 접촉 합**이다. 각 박스 쌍을 한 번만 세고 팔레트 경계는 제외한다. 접촉 자체가 없으면 null이며 보조 점수에서는0으로 기여한다. 후보 p_same와 리포트 지표를 같은 공식으로 구현하지 않는다.

출처: [metrics/clustering.ts의 contact/clusteringMetrics](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/metrics/clustering.ts), [clusterPacking.ts의 clusterRank](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/clusterPacking.ts).

## 11. 후보 비교: 하나의 가중합이 아닌 사전식 순서

`cluster-layer`는 물리 검사에 합격한 후보의 다음 벡터를 **왼쪽부터** 비교해 작은 쪽을 고른다.

```text
[
  바닥이면0/아니면1,
  newVoid,
  0,
  -p_same,
  -p_department,
  박스바닥z,
  좁은측면띠proxy,
  -전체박스면접촉,
  -상단높이가같은옆면접촉길이,
  -박스측면/팔레트경계접촉proxy,
  전체XY바운딩면적,
  전체최고높이,
  수평CoG편차,
  CoG높이,
  y, x, 회전동률키
]
```

부서 접촉도 표면적으로 정규화하며 부서는S1/S2, S3/S4, S5/S6, S7/S8처럼 번호 두 개씩 묶는다. 3번째 항은 cluster-layer에서 상수0이다. `cluster-floor`의250mm 높이 밴드를 cluster-layer에 넣지 않는다. 실제 비교는 차이 절댓값이1e-7을 넘는 첫 항에서 결정된다.

설명용 후보 A/B가 둘 다 물리 검사를 통과했다고 하자. A가 바닥(z=0), B가 위층(z>0)이면 B의 SKU 접촉이 많아도 A가 앞선다. 둘 다 위층이고 새 공극도 같다면 SKU 접촉이 높은 후보가 **현재 높이보다 먼저** 선택될 수 있다. 그래서 군집은 높은 연결 기둥을 만들 수 있지만 "위로만 쌓기"를 강제하지 않는다. 옆면 접촉도 보상한다.

Tetris(`floor-dense`)는 현재 z를 먼저 최소화하고 새 공극·측면 틈·접촉을 뒤에서 비교한다. 같은 SKU 항목이 없으며, 잔량 기반 예측 rollout이 추가로 있다. cluster-layer에는 그 rollout이 없다. 실제 미래 입고 순서는 어느 정책에도 노출하지 않는다. 후보128 확장과 추가 origins는 재현 가이드에 별도로 설명되어 있다.

출처: [clusterPacking.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/clusterPacking.ts), [floorDense.ts의 denseRank/compareDenseRank](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/floorDense.ts), [planner.ts](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/src/engine/planner.ts).

## 12. 벤치마크 점수와 물리 합격 판정은 별개다

보조 점수는 [score-plan.json](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/docs/benchmark-1000/score-plan.json)의 아래 식이다. 각 비율은0~1이다.

```text
S = 60·supplyAcceptance + 15·floorCoverage
  + 15·sameSkuContact + 10·deadlineCompliance              [0~100점]
deadlineCompliance = 1 - deadlineMisses/관측결정수
```

관측 결정이0개면 deadlineCompliance는0이다. 이것은 완료 trial을 요약하는 기술 점수이며, 후보의 물리 검사나 위 사전식 rank를 대체하지 않는다. 점수가 높다고 상자가 더 많은 하중을 버티거나 전역 최적이 되는 것은 아니다. 채택 판단은 **기본 적재 개수·부피와3D 밀도·공극**을 우선하고 SKU 군집은 추가 가치로 본다.

## 검증 범위와 한계

현재 구현은 직육면체 기하, 지지 면적, 누적 수직 하중, 비음수 반력과 정적 중심 여유, 합성 허용하중, 그리퍼/TCP 접근 근사를 검사한다. 상자 압축·파손의 재료역학 해석, 마찰 미끄럼, 진동·충격·동적 붕괴, 실제 로봇 IK/전체 링크/컨베이어·센서 지연을 검증한 것은 아니다. 박스 내부 질량도 균일하다는 가정이다.

따라서 "모델 검사를 통과한 적재 후보"라고 읽으면 정확하다. "실물 운송까지 안전하다는 인증"으로 읽으면 범위를 넘는다. 군집 접촉이 안정성을 증명하지도 않는다.

이 문서의 수치는 [동결 설정](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/docs/benchmark-1000/evaluation-v2/freeze.json)과 [실행 당시 소스 snapshot](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/docs/benchmark-1000/evaluation-v2/source-snapshot)에 대조했다. 새로운 엔진 계산·시뮬레이션·API 호출을 수행하지 않았고, 설명용 예제를 실제 실험 결과와 섞지 않았다.


PPT에 옮길 짧은 원고: [본문 2장·부록 1장 설명안](https://github.com/taehun0208/alps-pallet-loading-lab/blob/alps/testris-benchmark-20261010/alps-simulator/docs/ALPS-%EA%B5%B0%EC%A7%91-PPT-%EC%84%A4%EB%AA%85%EC%95%88.md).
