# 로봇 구성과 알고리즘 첫 화면 — v22

## 화면과 조작
- 사이트 기본 화면: `?palletView=single#pallet`. 바닥형 로봇 1대, 팔레트 1개로 시작한다.
- ‘이 박스를 고른 이유’에서 관측 → 후보 → 제약 → 후속 공간 → 명령의 판단 흐름을 본다. 실제 실행 중인 후보와 최근 검토한 미예약 후보를 구분한다.
- ‘다음 1개 적재’는 입고·계측·집기·적재·복귀 작업 한 건 완료 후 멈춘다. 유효 배치가 없으면 일시정지로 중단할 수 있다.
- `?palletView=relay#pallet`의 ‘확장성’ 탭은 기본 4대. 로봇 수 1–8대, 구성, 혼합형의 바닥형 수를 입력하고 ‘조건 적용 · 바로 재실행’을 누른다.
- 1안: 바닥 고정형 관절 로봇 + 흡착. 2안: 천장 X/Y 레일·Z 승강 + 흡착. 3안: 두 형태가 중앙 명령을 받아 함께 동작. 혼합형은 최소 2대, 각 형태가 1대 이상이다.
- 대수·구성 변경은 새 실행이다. 진행 중 예약을 폐기하고 Worker를 교체한다. 높이/구성만 변경하면 같은 박스 목록을 유지한다. 탭별 실험 상태는 따로 보존하며 숨겨진 탭의 시간은 진행하지 않는다.
- JSON 내 `scenario.pallet.robotLayout`은 작업셀 배치 메타데이터다. 팔레트의 물리 경계나 치수를 변경하지 않는다. 오래된 입력에 필드가 없으면 종전의 4대 바닥형을 재현한다.

## 중앙 판단과 실행 연결
`fleet.ts`가 구성 검증·로봇 종류·천장형 범위·허용 회전을 정의한다. 생성기, 배차 반복문, 컨베이어 길이/픽업 구역, 씬과 공장 크기가 같은 수를 사용한다. 각 로봇당 팔레트 1개, 한 개 공용 컨베이어를 유지한다.

`centralDispatch.ts`의 중앙 배정 방식과 예산은 유지한다. 로봇마다 별도 계획기를 실행하는 구조가 아니다. 중앙 Worker가 모든 팔레트의 상태와 계측 완료 박스만 받고, 중복 없는 명령을 선택한다. 아직 실제 원격 서버 통신은 아니다.

`motion.ts`는 바닥형에 기존 가상 팔 도달 검사를 사용하고 천장형에는 Cartesian 범위·수직 공구축을 검사한다. 운반 박스·그리퍼 경로 및 동시 예약 간섭 검사는 공통이다. 천장형은 XY 평면 0/90도 회전만 허용한다. 바닥형의 기존 허용 회전은 유지된다.

## 수치와 범위
- 단위 mm / kg / s. 로봇 수 1–8대는 브라우저 계산·표시 예산에 둔 상한이다.
- 천장형 TCP 범위: 팔레트 중심 X ±1400mm, Y -2100~(팔레트 깊이+350)mm, Z ≥0, TCP Z+그리퍼 높이 ≤3400mm. 레일 중심 높이 3900mm. `gantryEnvelope`에서 변경 가능하다.
- 기존 팔레트 1800×1500mm, 기본 높이 1600mm와 편집 범위 600–2000mm 유지.
- 기존 지지율 92%, 누적하중·무게중심·회전·높이·경계 검사는 완화하지 않았다.
- 두 종류 모두 같은 기존 TCP 속도·가반하중 설정을 사용한다. 시간은 그 가정에 따른 추정이며 실제 Hyundai/갠트리 장비 성능 비교가 아니다.
- 천장형은 제조사 기종이 없는 가상 XYZ+Yaw 모델이다. 링크·레일·지지구조 전체 충돌, 힘 제어, 진공 밀봉, 실제 흡착 성공, 레일 처짐 및 실제 로봇 관절제한은 검증하지 않는다.
- HD현대로보틱스 로봇 본체는 흡착 전용으로 고정된 장비라는 의미가 아니다. 공식 사례는 본체와 별도 그리퍼 구성을 설명한다. 이번 시뮬레이터는 세 안 모두 진공 흡착을 가정한다.
  - https://hd-hyundairobotics.com/en/application/robot-solution/13
  - https://hd-hyundairobotics.com/en/application/robot-solution/38

## 검증
- `pallet-fleet.test.ts`: 18개 통과. 1/2/4/8대 바닥형·천장형과 2/4/8대 혼합형의 동시 명령·예약·작업 완료, 중복집기 방지, 수량 보존, 낡은 실행 명령 거절, 좌표 역변환, 컨베이어 범위, 천장형 도달/자세, 설정 유지.
- 기존 stream / stream-settings / stream-return / relay / com-assessment / ordering / central-dispatch 포함 8개 테스트 파일 **62개 통과** (2026-10-09).
- TypeScript 검사와 Vite production build 통과. 기존 Three.js 공유 청크의 500kB 경고는 남아 있다.
- 실제 브라우저: 기본 1대, ‘다음 1개 적재’ 1개 완료 후 정지, 천장형 적재, 6대(3+3) 혼합형 렌더링·적재를 확인.
- 320/375/414/768/1920px에서 문서 가로 폭과 중앙 뷰포트 확인. 1920×1080과 모바일 화면 직접 확인.

## 변경 파일
기존: PalletLab, types, FlowLab, useStream, streamEngine, streamPlanner, motion, layout, conveyor, ConveyorView, FactoryEnvironment, RelayScene, streamSettings, twinSceneTheme, twin.css, index.html, design.md.
추가: fleet.ts, GantryView.ts, DecisionInspector.tsx, dashboardView.ts, pallet-fleet.test.ts, 이 문서.
기존 논문 실험·Baseline 모듈은 유지한다. 새 알고리즘 성능 개선을 주장하는 작업이 아니다.
