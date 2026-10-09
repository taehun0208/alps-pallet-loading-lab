# 적재율·균형·빈공간의 정적 Factor 분석

이 자료는 기존 `docs/presentation/claude/executed-capacity.json` 40행을 읽어 독립 재계산한 파생 자료입니다. **새 시뮬레이션이나 설정 변경은 없습니다.** 원본 SHA-256은 `8c91beec4d75aafad422a89c3b4f6e785c20ca9310513c6424c1a5c409b3e659`입니다. 상하 박스의 무게 순서 규칙은 기존 합의대로 `heavyRule=off`입니다. 지지·가정 허용하중·로봇 근사 제약은 원본에 적용되어 있습니다. MCTS는 이 자료에 포함하지 않았습니다.

## 발표 문장

“같은 72개 입고·1,200 mm 단일 팔레트 조건에서 적재율뿐 아니라 화물 무게중심, 사용 높이까지의 비점유 체적, 최소 지지면적, 가정 허용하중 사용률을 따로 계산했습니다. 각 알고리즘의 평가 입고 순서 5개를 점으로 보여주며 큰 점은 평균입니다. 각 지표가 다르게 움직이므로 임의의 종합점수 하나로 합치지 않았습니다.”

그림 왼쪽 알고리즘 아래의 적재 개수와 사용 높이도 평가 5회의 평균입니다. 선은 관측 최솟값~최댓값이며 신뢰구간이 아닙니다. 알고리즘마다 실제 적재 수량·상품 구성이 다르므로 낮은 무게중심이나 작은 남은 체적 하나만으로 전체 품질의 우월성을 확정하지 않습니다.

## 지표 계산식

- `fill` = 적재 부피 / (팔레트 가로 × 세로 × 허용 높이). JSON에서 비율 0~1, `fillPercent`는 %입니다.
- `count` = 실제 확정 배치 개수. 미적재 및 미처리 개수는 별도 보존합니다.
- `cogXMm`, `cogYMm`, `cogHeightMm` = Σ[상자 질량 × (상자 좌표 + 축 길이/2)] / Σ상자 질량. **각 상자 내부 질량 분포가 균일**하다고 가정하며 서로 다른 품목의 질량은 원본값을 사용합니다. 모든 상자의 밀도가 같다는 가정이 아닙니다. 팔레트 자체 질량은 제외합니다.
- `cogOffsetMm` = sqrt[(CoGx - 팔레트 가로/2)^2 + (CoGy - 세로/2)^2]. 화물의 수평 편심이며 동적 진동 안정성 점수가 아닙니다.
- `usedHeightMm` = max(상자 z + 상자 높이).
- `voidLiters` = (팔레트 가로 × 세로 × 사용 높이 - 적재 상자 부피) / 1,000,000. 단위는 L입니다. **외접 부피 내 비점유 체적**이며, 개방된 측면 공간도 포함합니다. 갇힌 빈틈(trapped void), 접근 불가능한 공간, 물리적으로 활용할 수 없는 공간을 측정한 값이 아닙니다.
- `minSupport` = 실행의 배치 중 가장 작은 `supportRatio`. JSON에서 비율 0~1입니다. 그림과 `minSupportPercent`는 %입니다. 평균 그래프는 각 실행 최솟값 5개의 평균입니다. 원본 지지 면적 하한 85%는 점선으로 표시합니다.
- `loadRatioRawMax` = max(loadAbove / maxLoadKg).
- `loadRatioMax` = max[loadAbove / (maxLoadKg × strengthFactor / loadSafetyFactor)]. 이번 자료는 안전계수 1.2, strengthFactor 기본값 1이며 원본 `materials.ts`의 허용하중 정의에 맞춥니다. 그림은 이 값 ×100입니다. 평균은 실행별 최대값 5개의 평균입니다. **강도·허용하중은 synthetic 모델 가정**으로 제조사 인증이나 실측 강도는 아닙니다. 100% 점선은 가정 허용하중입니다. 알려지지 않은 허용하중이 있으면 집계값을 null로 둡니다.
- `extraFit` = 미적재 품목별 확장된 잔여 후보 탐색에서 유효 후보가 발견된 품목 수. `extraFitAny`는 그 수가 0보다 큰지입니다. **0은 샘플에서 발견하지 못했다는 뜻**이며 전역 최적성·더 넣을 수 없음의 증명이 아닙니다.

## 시간 해석

원본 실행의 기한은 **계획기 호출당 8초**로 그대로 유지합니다. 최신 운영 목표 10~12초는 저장된 호출 최대값과의 **사후 비교**이며, 원본을 10~12초 실험으로 재라벨하지 않았습니다. `sourceCallDeadlineMs`, `sourceCallDeadlinePassed`와 `postHocCallsWithin10000ms`, `postHocCallsWithin12000ms`를 별도로 제공합니다.

시간은 원본의 호출 wall-clock 측정입니다. 전체 제어주기, 인식·통신·검증 시간, 실제 로봇 동작시간은 미측정입니다. 보류 재검토로 한 배치 뒤 여러 번 호출될 수 있으므로 개별 호출이 목표 이하라는 사실로 다음 박스 전체 처리가 목표 내라고 보장하지 않습니다. 알고리즘 `p95Ms`는 실행별 P95 5개의 평균이며 pooled P95가 아닙니다. `maxMs`는 5회 중 관측 최대입니다.

## 미측정과 범위

`trappedVoidLiters`, `dynamicVibrationResistance`, `fullRobotIKPass`, `recognitionLatencyMs`, `measuredRobotCycleSeconds`, `endToEndCyclePass10s`는 **null**입니다. 0이나 통과로 채우지 않았습니다. 동적 운송 진동, 실제 로봇 IK/전체 링크 충돌, 센싱·실물 사이클 검증 자료가 아닙니다. 총 5개 평가 시드의 제한된 내부 관측치입니다.

## 파일

- `08-packing-balance-void.png` (3,840×2,160) / `.svg`: 발표용 16:9 그림.
- `alps-quality.json`: `schema`, `source`, `algorithms`, `rows`, `definitions`, `limitations`을 포함한 앱 데이터. algorithm 숫자는 평가 5회 평균이고 `observations`는 5개 원 관측입니다. 전체 `rows` 40개는 선택 15 + 평가 25입니다.
- `quality-trials40.csv`, `quality-holdout5-summary.csv`: 원시 파생 지표와 평가 집계.
- `QUALITY-PROVENANCE.json`: 입력 및 생성기 SHA와 검산 내용.
- `ALPS-quality-factors.zip`: 이 신규 지표 자료만 묶음.

재현: `python scripts/presentation-quality-charts.py`. 원본 실험·모델·기존 그래프는 변경하지 않습니다.
