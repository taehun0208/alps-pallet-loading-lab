# 대형마트 대상 혼합 팔레타이징: 기술 현황과 주장 검증

조사 기준일: **2026-10-09, 한국 시간**. 공개된 제조사·솔루션 공급사·설비 운영사·전시 주최자의 1차 자료를 확인했다. 기술 소개, 전시 시연, 도입 발표, 실제 운영 보고, 최대 사양을 구분했다. 공급사 설명을 독립 실측이나 전체 시장 보급률로 해석하지 않는다. 사용자가 붙여 넣은 소개 글과 링크는 검증할 자료로 취급했다.

기존 조사와 연결: [산업 솔루션과 미해결 범위](pac2026-existing-mixed-pallet-solutions.md), [실제 고객 사례](pac2026-mixed-pallet-customer-cases.md).

## 1. 조사에서 얻은 방향

대형마트를 대상으로 한다면 우선 고객 공정을 **물류센터에서 매장별로 출하하는 케이스·박스 단위 혼합 적재**로 좁히는 것이 타당하다. 아래 사례에서는 매장 주문·진열 순서에 맞춘 적재, 무거운 상자 반복 취급, 다양한 포장 대응이 실제 설비 설계에 반영된다. 온라인 장보기 고객 한 명의 주문을 낱개로 집어 봉투·토트에 담는 공정은 품목 단위와 산출물이 다르다.

상용화 수준은 이미 높다. Walmart·Jumbo·Coles는 자동화 물류센터 운영을 발표했고, dm은 매장 진열 동선을 반영한 로봇 적재를 운영한다. 그러나 이러한 대형 시설의 성과에는 저장·정렬·운반·정보 시스템이 함께 기여한다. 우리 해커톤의 적재 알고리즘 하나가 같은 성과를 재현한다고 말할 수는 없다. 각 운영 근거는 다음 표에 연결했다.

### 실제 유통·소매 관련 운영 사례

| 고객·현장 | 실제 설비와 공정 | 확인된 상태·날짜 | 해커톤에 주는 시사점과 수치의 범위 |
|---|---|---|---|
| **Walmart, 미국 식료품 공급망** | 입고 품질검사·팔레트 해체 → 온도 관리 자동 저장 → 매장 부서에 맞춘 팔레트 생성. 깨지거나 눌리기 쉬운 계란·과일은 위쪽 배치 | 운영사 2024-07-10 발표. Shafter는 2021년부터 가동. 2025-07-24 후속 글은 찌그러짐·부풀음·테이프 풀림 검사와 매장 주문 데이터 기반 AI Pallet Builder를 설명. [2024 운영사 발표](https://corporate.walmart.com/content/corporate/en_us/news/2024/07/10/walmarts-grocery-network-transformation-the-next-steps-on-our-supply-chain-modernization-journey.html), [2025 후속 발표](https://corporate.walmart.com/news/2025/07/24/retail-rewired) | 매장 작업 편의·포장 상태·상품 특성을 함께 고려. 공급 능력·처리량 2배 주장은 **센터 전체**에 대한 설명이며 로봇팔 속도나 적재 알고리즘 단독 효과가 아님 |
| **Jumbo, 네덜란드 Nieuwegein 신선 물류센터** | 냉장 식품을 매장행 롤컨테이너에 구성. CPS·AIO와 자동 처리가 어려운 크기·형태를 위한 수작업 공정 병행 | 2024-04-25 가동 개시 발표. 2024년 말부터 726개 매장 공급을 후속 확인. [개시 발표](https://www.jumbo.com/nieuws/jumbo-creeert-grootste-gemechaniseerde-foodretail-distributiecentrum-van-europa-met-in-gebruik-name-cdc-vers/), [2024년 실적 발표](https://www.jumbo.com/nieuws/jumbo-legt-in-2024-solide-basis-voor-hernieuwde-groeifase/) | 2024년 소개의 신선 품목 약 50% 기계화는 도입 당시 계획·설명. 현재 실측 50%로 쓰지 않음. WITRON의 2026-01-30 설명은 약 3,000개 신선 SKU·30 COM·약 2°C·하루 100만 단위 초과 능력을 제시하며, 전부 센터 구성·능력임. [공급사 후속 설명](https://witron.de/en/news/the-first-violin-in-a-perfectly-tuned-supply-chain-orchestra) |
| **Coles, 호주 Kemps Creek** | 매장 공급용 대형 자동화 유통센터. 케이스의 저장·주문 처리·매장별 출하를 통합 | 2024-08-06 개장. FY25 보고는 두 ADC 모두 완전 가동 상태로 설명. [운영사 개장 발표](https://www.colesgroup.com.au/news/2024/media-releases/?page=coles-unveils-state-of-the-art-distribution--centre-in-western-sydney-), [Coles FY25 연차보고](https://www.colesgroup.com.au/annual-report/?id=mG8zfP9qbEuTl-6yVoD7Kw&page=end) | 229개 매장·주 400만 상자 초과는 개장 발표의 완전 가동 시 설계 능력. 매장별 주문 물량을 대규모 설비로 처리하는 예이며 로봇팔 1대의 주간 처리량이 아님 |
| **dm-drogerie markt, 독일 Wustermark** | 265,000개 포장 단위 버퍼, 로봇 셀 7개와 수작업 라인 8개. 매장 진열 동선을 고려해 꺼낼 순서의 역순으로 적재 | 2020년 봄 가동, 공급사 2020-10-22 발표. [Swisslog 공식 사례](https://www.swisslog.com/en-au/about-swisslog/newsroom/news/2020/10/swisslog-dm-drogerie-markt-german-logistics-prize) | 매장 친화 적재의 구체적인 운영 사례. 최대 4개 포장 동시 취급은 이 구성의 설명이며, 2026년 신규 기술로 소개하지 않음. 대형 버퍼와 순서 정렬의 기여를 함께 기록 |
| **롯데칠성음료, 한국 부평 물류센터** | 팔레트 자동창고 → 층 단위 해체·피킹 → Multishuttle 버퍼·순서 정렬 → RapidPall 혼합 팔레트 → 출하 | Dematic 2025-08-05 구축 발표. [공급사 공식 사례](https://www.dematic.com/en-au/newsroom/press-releases/2025/south-koreas-first-fully-automated-multi-product-order-fulfilment-distribution-centre-for-lotte-chilsung/) | 국내 혼합 주문 자동화의 실제 사례. **음료 공급기업의 물류센터**로 롯데마트 설치 사례와 구별. 알고리즘 외 저장·시퀀싱 설비가 포함됨 |

### 국내 관련 사례를 인용할 때의 경계

Ocado는 2026-08-09 한국 롯데의 부산 자동화 CFC 가동을 발표했다. 600 Series 로봇, OGRP 로봇팔, 자동 냉동 처리 등이 포함된다. 이는 **소비자 온라인 장보기 주문의 피킹·포장 자동화**에 대한 근거다. 매장행 혼합 팔레타이징의 설치 실적으로 계산하면 안 된다. [Ocado 공식 발표](https://www.ocadogroup.com/newsroom/news/ocado-launches-first-automated-cfc-with-lotte-in-south-korea)

이번 자료만으로 한국 대형마트의 혼합 팔레타이징 로봇 설치 대수나 자동화 비율을 정량화할 수는 없다. 국내 관련 사례가 존재한다는 사실과, 특정 국내 대형마트 물류센터가 우리가 제안한 셀을 필요로 한다는 수요 검증은 나누어 다뤄야 한다.

## 2. 현재 설비의 두 가지 큰 구성

| 구성 | 공정과 전제 | 장점·제약을 읽는 법 | 관련 사례 |
|---|---|---|---|
| **저장·순서 정렬을 포함하는 통합 자동화** | 단일 품목으로 들어온 상품을 해체·보관한 뒤 매장 주문과 적재 계획에 맞춰 인출하고 쌓음 | 주문·매장 진열 순서를 미리 활용할 수 있음. 최종 적재 결과에는 대형 저장·버퍼·제어 시스템의 역할이 포함됨 | Walmart, Jumbo, Coles, dm, 롯데칠성. 세부 구성은 위 원문별로 다름 |
| **기존 컨베이어에 연결하는 적응형 적재 셀** | 혼합 박스를 받아 비전과 품목 데이터로 다음 배치 결정. 내부에 작은 버퍼를 둘 수도 있음 | 기존 입고 흐름에 대응하지만 SKU·포장·하중·순서 변경·활성 팔레트 범위를 명시해야 함 | CMES, Progressive, Jacobi, Mujin TRUSCO, CJ 이동형 셀 |

위 구분은 공개 사례를 읽기 위한 분석 틀이며 모든 제품을 배타적으로 나누는 표준 분류는 아니다. 통합 설비 안에 적응형 로봇 셀이 들어갈 수도 있다.

또한 자동 적재 설비가 모두 관절형 로봇팔은 아니다. WITRON OPM은 **COM 적재 장치와 케이스 처리 시스템**으로 설명된다. 갠트리, 케이스 적재 장치, 관절형 팔을 구분해야 우리가 사용하는 로봇팔·경로 제약과 비교할 수 있다. [WITRON OPM 공식 설명](https://witron.de/en/solutions/OPM)

WITRON이 홍보하는 시간당 500픽 초과와 상품 범위 95% 초과는 제품 능력 설명이다. 특정 Jumbo 공정의 실제 자동화 비율이나 각 설치 현장의 평균 속도를 의미하지 않는다. 공급사가 제시하는 적용 가능 범위도 실제 상품 구성에 따라 확인해야 한다. [WITRON OPM](https://witron.de/en/solutions/OPM), [Jumbo 도입 당시 공정 설명](https://www.jumbo.com/nieuws/jumbo-creeert-grootste-gemechaniseerde-foodretail-distributiecentrum-van-europa-met-in-gebruik-name-cdc-vers/)

## 3. 먼저 고쳐야 할 설명

다양한 상품 박스를 같은 팔레트에 적재하는 기능은 이미 상용 제품과 실제 운영 사례에 존재한다. 다만 **무작위로 공급받기, 버퍼 없이 쌓기, 다음 박스를 모르는 상태에서 결정하기, 모든 포장물을 처리하기**는 서로 다른 조건이다. 제품별 작업 범위와 필요한 주변 설비를 따로 봐야 한다.

| 붙여 넣은 글의 주장 | 확인 결과 | 발표에 사용할 수 있는 표현·근거 |
|---|---|---|
| 최근 설비는 순서 없이 들어오는 박스를 바로 쌓는다 | **일부 제품에서 확인. 일반화는 부적절** | Progressive는 무작위 공급과 사전 정렬 불필요를 제품 기능으로 명시한다. 반면 CMES의 7 SKU 설명에는 자체 버퍼가 등장한다. 같은 랜덤 공급 대응이라도 내부 순서 변경 여부가 다르다. [Progressive 제품](https://progressiverobotics.ai/mixed-palletizing/), [CMES, 2026-02-26](https://blog.cmesrobotics.ai/aw2026-cmes-solution) |
| No-Teaching이면 새 품목과 현장을 설정 없이 처리한다 | **의미 확대** | Mujin은 새 SKU의 로봇 동작 티칭 불필요를 설명한다. 이것만으로 치수·하중·포장별 제약, 입출력 연동, 설치·시운전까지 불필요하다는 결론은 나오지 않는다. 전시 시연과 현장 적용 조건도 다르다. [Mujin MODEX 2026 시연 보고](https://mujin-corp.com/resources/blog/mujin-modex-2026-physical-ai-at-work) |
| 3D 카메라는 로봇 팔 위에 달리며 0.x초 안에 크기·재질까지 판단한다 | **인용 출처로는 입증되지 않음** | Photoneo 글은 상부 스캐너로 치수·위치·자세를 측정하고 WMS 정보와 대조하는 구성을 설명한다. 전체 재질 분류 완료시간 0.x초는 확인되지 않는다. 반사·투명 포장을 촬영하는 능력과 포장 재질·강도 분류는 구별해야 한다. [Photoneo, 2026-02-03](https://www.photoneo.com/jacobi-robotics-partnership-mixed-case-palletizing/) |
| 최신 팔레타이저는 진공과 클로를 결합한 하이브리드 그리퍼가 보편적이다 | **보급 정도 미확인** | 복합 그리퍼는 실제 제품이지만 용도에 따른 선택이다. Schmalz는 층 단위의 진공·기계식 복합 취급을 제공하고, AmbiStack 가이드는 흡착식 그리퍼를 명시한다. [Schmalz SPZ-MC](https://www.schmalz.com/en-de/products/automation-743270/vacuum-grippers-746238/gripping-systems-and-end-of-arm-tooling-eoat-746240/layer-gripping-systems-398095/modular-layer-gripper-spz-mc-398096), [AmbiStack 가이드, PDF p.3](https://www.ambirobotics.com/wp-content/uploads/AmbiStack_Solution-Guide_v1.pdf) |
| CJ 이동형 로봇은 4개 이상의 매장행 팔레트를 동시에 채운다 | **수치·고객 맥락 수정 필요** | 공식 발표는 **최대 4개**이며, 당시 실제 운영은 1대가 2개 도시의 출고를 처리했다. 현장은 해외 소비자 주문을 처리하는 인천GDC다. 매장 보충 사례로 바꾸어 소개하지 않는다. 내부에 회전형 자동 버퍼도 사용한다. [CJ대한통운, 2025-07-17](https://www.cjlogistics.com/ko/newsroom/news/NR_00001260) |
| CMES가 PACK EXPO International 2026에서 이미 선보였다 | **날짜 오류** | 전시는 **2026-10-18~21, 시카고**로 조사일 이후다. CMES는 10월 1일 자사 글에서 미국 첫 공개를 예고했다. **전시 예정**으로 표현한다. [주최자 일정](https://www.packexpointernational.com/the-show), [CMES 예고, 2026-10-01](https://blog.cmesrobotics.ai/imts-autonomous-manufacturing) |
| Pickle과 Ambi는 같은 종류의 혼합 팔레타이징 업체다 | **공정 구분 필요** | 2026년 공동 발표에서 Pickle은 트레일러 하역, AmbiStack은 컨베이어로 받은 박스의 식별·스캔·적재를 담당한다. 입고 공정의 연결 사례이며, 특정 대형마트의 매장행 주문 팔레트 운영 증거는 아니다. [Ambi·Pickle 통합 발표, 2026-06-30](https://www.ambirobotics.com/media/physical-ai-inbound-logistics/) |
| 무게중심을 낮추고 맞물려 쌓으면 물리적 안정성을 해결한다 | **설계 요소로는 적절하나 충분조건은 아님** | 치수·무게 외에 압궤 강도와 목적지 요구를 규칙으로 고려하는 구성도 있다. 우리 실험의 지지율·무게중심 통과를 운송 중 파손·붕괴 방지의 실측 입증으로 쓰지 않는다. [Photoneo, 2026-02-03](https://www.photoneo.com/jacobi-robotics-partnership-mixed-case-palletizing/) |

## 4. 기업별로 실제 확인된 것

| 기업·제품 | 확인된 기능·설비 구성 | 증거 단계와 날짜 | 아직 확인되지 않은 범위 |
|---|---|---|---|
| **CMES Mixed-Case Palletizer** | 공식 2026년 2월 자료에 박스 7종 혼합 적재, 컨베이어 비전, 자체 버퍼, 자동 패턴 생성. 현행 영문 제품 사양은 7종 박스 크기와 Max SKU 7로 표기 | 제품 소개와 **AW 2026 전시 시연** 보고. 2026-02-26·03-04. [제품 설명](https://blog.cmesrobotics.ai/aw2026-cmes-solution), [전시 현장](https://blog.cmesrobotics.ai/cmes-aw2026) | 이 자료만으로 대형마트의 모든 품목·포장이나 수천 종류의 외형을 처리한다고 말할 수 없음. 상품 SKU 수와 박스 외형 규격 수의 관계는 확인 필요 |
| **Progressive AnyStack** | 무작위 공급에서 혼합 적재, 비전으로 치수·방향 측정, 배치 및 동작 계획. 사전 시퀀싱과 추가 버퍼를 없앨 수 있다고 설명 | **공급사 제품 기능 주장**. 게시일 미표기, 2026-10-09 확인. [공식 제품](https://progressiverobotics.ai/mixed-palletizing/) | 이 페이지에는 검증 가능한 실명 소매 고객, 장기 정지율, 동일 조건의 현장 처리량 자료가 없음. 안정성 보장·밀리초 추론을 조건 없는 성능으로 사용하지 않음 |
| **Mujin / TRUSCO Planet Saitama** | 포장기에서 불규칙하게 나온 박스를 실시간 적재. 중앙 시스템 치수를 비전으로 대조, 동일 크기 복수 집기, AMR이 놓은 팔레트 위치 보정 | **실명 고객의 공급사 운영 사례**. 원문 게시일 미표기, 2026-10-09 재확인. [TRUSCO 사례](https://mujin-corp.com/resources/blog/on-the-fly-mixed-sku-palletizing-at-trusco-nakayama-s-flagship-distribution-center-an-innovative-leap-forward) | 산업용품 유통기업 사례로 대형마트 자체는 아님. 버퍼 규모, 알고리즘, 원시 운영 로그 미공개 |
| **Mujin / MODEX 2026** | 매장 공급용 혼합 적재와 혼합 해체를 별도 시연. 새 SKU 동작 티칭 불필요와 복수 집기 설명 | **전시 시연 보고**. 시연 2026-04-13~16, 글 게시일 미표기. [공식 시연 보고](https://mujin-corp.com/resources/blog/mujin-modex-2026-physical-ai-at-work) | 약 1,000케이스/시간은 별도 inbound 시연 설명에 붙은 값. 이를 혼합 주문 팔레타이징의 현장 평균으로 가져오지 않음 |
| **Jacobi / Delta Technology** | 기존 출하 컨베이어에서 사전 순서 정렬 없이 혼합 적재, FANUC 로봇, 목적지 팔레트 2개 | **익명 방산 제조업체의 공급사 운영 사례**. 2025년 4분기 시운전, 2026-01-13 게시. [도입 사례](https://jacobirobotics.com/case-study/deployment-with-delta-tech) | 대형마트 사례는 아님. 최대 적재율·안정성 수치의 표본과 시험 조건 미공개. 본문 중량 표기가 50lb와 60lb로 불일치 |
| **Photoneo + Jacobi 기술 설명** | 상부 3D 스캔, WMS 대조, 적재 후 검사. 고급 구성에는 소형 버퍼 로봇·선반을 활용한 순서 관리도 소개 | **기술 구성 설명**. 2026-02-03. [공식 기술 글](https://www.photoneo.com/jacobi-robotics-partnership-mixed-case-palletizing/) | 모든 Jacobi 설치가 같은 버퍼 구성을 사용한다는 뜻은 아님. 특정 고객의 평균 처리량·재질 분류시간은 이 글로 확정 불가 |
| **CJ대한통운 이동형 팔레타이저** | 앞뒤 이동, 최대 팔레트 4개, AI 크기 인식·도착지 분류, 로터리 버퍼 | **운영사 상용화 발표**. 2025-07-17, 인천GDC. [공식 발표](https://www.cjlogistics.com/ko/newsroom/news/NR_00001260) | 당시 운영은 2개 도시 출고. 대형마트 매장 보충·4개 초과 팔레트·처리량 수치는 확인 안 됨. 본문은 이동 구조를 설명하지만 레일 방식의 세부 사양은 제공하지 않음 |
| **AmbiStack** | 갠트리로 여러 팔레트에 분류·적재, 흡착 그리퍼, 스캔 터널, 같은 크기의 박스 복수 집기, 적재 후 비전 확인 | **제품 가이드**와 아래 통합 가동 발표. 가이드 게시일 미표기, 2026-10-09 확인. [공식 PDF](https://www.ambirobotics.com/wp-content/uploads/AmbiStack_Solution-Guide_v1.pdf) | 6·12개 이상 팔레트는 제품 구성 설명. 모든 팔레트에서 동시에 물리적으로 집고 놓는다는 뜻은 아니며, 대형마트 진열 순서 성과도 아님 |
| **Pickle + AmbiStack** | 트레일러에서 하역한 박스를 컨베이어로 넘겨 스캔·팔레트 적재까지 연결 | **상업 통합 배치 발표**. 2026-06-30. [공식 발표](https://www.ambirobotics.com/media/physical-ai-inbound-logistics/) | 고객은 Fortune 500 소매·물류 기업으로만 표현, 실명·장소·처리량·전후 성과 미공개. 수주 매진과 설치·정상 가동 실적을 혼동하지 않음 |

CMES 현행 [영문 제품 사양](https://cmesrobotics.ai/en/products/palletizer)은 검색엔진이 색인한 공식 페이지 전문에서 Standard 최대 300 PPH, Prime 최대 500 PPH(멀티픽)를 제시한다. 직접 페이지 열기는 403으로 막혔으므로 이 수치는 보조 참고로만 기록한다. 모두 **최대 제품 사양**이며 혼합 박스 장기 평균 실측이 아니다. 7 SKU 설명과 버퍼 유무는 직접 열람 가능한 2월 공식 블로그에서 교차확인했다.

## 5. 요즘 설비를 이해할 때 필요한 구분

**사전 순서 정렬형과 랜덤 공급 대응형이 함께 존재한다.** 셔틀·버퍼가 공급 순서를 만든 뒤 쌓는 시스템과, 들어온 박스에서 다음 배치를 결정하는 시스템은 서로 다른 문제를 푼다. 여기에 작은 버퍼로 일부만 재정렬하는 방식도 있다. CJ와 CMES 사례는 작은 버퍼의 존재를 기록해야 한다. Progressive·Jacobi의 사전 정렬 불필요 주장을 다른 회사의 제품에 옮겨 적용할 수 없다. 이는 앞의 제품 비교에서 얻은 해석이다.

**티칭 자동화와 품목 정보 관리는 별개다.** TRUSCO 사례에서는 중앙 시스템 치수를 받아 비전으로 확인한다. 따라서 우리가 로봇 경로를 자동 생성하더라도 무게·압궤 한계·취급 방향·그리퍼 적합성 같은 입력의 확보 방식을 따로 설계해야 한다. 비전만으로 보이지 않는 품목 속성까지 정확하게 추정한다고 가정하지 않는다. [Mujin TRUSCO 사례](https://mujin-corp.com/resources/blog/on-the-fly-mixed-sku-palletizing-at-trusco-nakayama-s-flagship-distribution-center-an-innovative-leap-forward)

**팔레트 수와 동시 집기 수를 분리해야 한다.** 여러 목적지 팔레트를 채울 수 있는 것은 분류·배분 능력이고, 여러 상자를 한 번에 집는 것은 동작당 처리량이다. AmbiStack 가이드는 두 기능을 별도로 설명한다. 한 시간의 박스 처리량을 단일 박스의 로봇 왕복시간으로 바꾸려면 멀티픽 수, 대기·교체·정지 포함 여부를 알아야 한다. [AmbiStack 가이드, PDF pp.2–5](https://www.ambirobotics.com/wp-content/uploads/AmbiStack_Solution-Guide_v1.pdf)

**최신 기능 목록을 시장 전체의 표준으로 부르기에는 근거가 부족하다.** 이번 자료는 제품이 존재하고 일부 현장에서 쓰인다는 점을 입증한다. 모든 대형마트가 노티칭·혼합 적재·복합 그리퍼를 운영한다는 보급률 조사는 아니다. 특히 피스피킹, 팔레트 해체, 트럭 하역의 고객·처리량을 혼합 팔레타이징의 실적으로 옮겨 쓰지 않아야 한다.

**매장 주문을 아는 것과 컨베이어 도착 순서를 아는 것은 다르다.** Walmart는 매장 주문 데이터로 팔레트를 계획한다. 따라서 소매 물류 문제를 무조건 미래 상품 목록도 모르는 순수 온라인 문제로 정의하면 실제 공정과 멀어질 수 있다. 해커톤에서는 주문 품목·수량의 사전 공개 여부와 실제 도착 순서의 비공개 여부를 별도 조건으로 써야 한다. [Walmart 2025 후속 발표](https://corporate.walmart.com/news/2025/07/24/retail-rewired)

**포장 품질은 알고리즘 외부의 운영 조건이기도 하다.** Jumbo 공급사 안내는 포장 품질, 팔레트, 포장 필름과 간지 등의 요구사항을 제시한다. 제품이 적재 가능하더라도 들어오는 포장이 자동 취급 조건을 만족하는지 확인하는 과정이 필요하다. [Jumbo CDC Nieuwegein 공급사 안내](https://www.jumbo.com/supplier/cdc-nieuwegein)

**AI·Physical AI·노티칭이라는 명칭만으로 내부 알고리즘은 알 수 없다.** 이번에 확인한 제품 자료는 대체로 동작과 기능을 설명하며, MCTS·GLAS와 직접 비교할 재현 가능한 구현·평가 조건을 공개하지 않는다. 어떤 공급사는 학습 방식을 소개하더라도 그것이 우리 문제에서 MCTS의 성능을 입증하지는 않는다. '상용 업체도 AI를 쓰니 MCTS가 정답'이라는 결론은 이번 조사로 뒷받침되지 않는다.

## 6. 해커톤에 적용할 검증 가설

아래는 조사 내용을 바탕으로 제안하는 범위다. 고객 인터뷰로 확인된 미충족 수요나 검증된 성능 우위는 아니다.

**추천 주제: 매장 출하 셀에서 실제 도착 순서를 몰라도 매장 주문을 끝까지 안전하게 쌓고 매장 재분류를 줄이는 배치 판단.** 한 매장으로 나가는 상온 직육면체 박스부터 시작하고, 품목별 크기·무게·압궤 한계·진열 구역은 주어진 데이터로 취급한다.

공식 미션에서 버퍼와 복수 활성 팔레트를 허용하는지는 이번 조사에서 확인하지 않았다. **기본 비교는 버퍼 0개**로 두고, 2개 또는 4개의 작은 버퍼는 규정이 허용할 때 확장 시나리오로 추가한다. 활성 팔레트 수도 규정과 현장 가정에 맞춰 고정해야 한다.

### 최소 구현 범위

| 항목 | 권장 조건 | 결정해야 하는 이유 |
|---|---|---|
| 고객 공정 | 물류센터 → 한 매장 주문의 케이스 출하 | 소비자 주문 낱개 피킹과 평가 단위를 맞추지 않기 위해 |
| 주문 정보 | 품목과 총 수량은 공개, 실제 컨베이어 도착 순서는 숨김 | 주문 정보의 이익과 순서 불확실성을 동시에 표현 |
| 포장 | 상온 직육면체 골판지 박스 | 쌀포대·유연 포장·노출 트레이는 후속 확장. 현재 물성 모델의 적용 범위를 명확히 함 |
| 선택권 | 기본은 버퍼 0개. 규정 허용 확인 후 2개 또는 4개를 확장 시나리오로 비교 | 순서 변경의 이익과 알고리즘의 이익을 분리 |
| 팔레트 | 크기·높이·총중량·활성 팔레트 수를 고정. 복수 활성 팔레트 허용은 규정 확인 필요 | 방식별 숨은 자원 차이를 방지 |
| 로봇 | 같은 그리퍼와 도달·충돌·접근 제약 사용 | 배치 좌표와 실제 실행 가능성을 연결 |
| 품목 물성 | 무게·허용 상부 하중·방향 제한을 명시적 입력으로 제공 | 카메라가 재질·강도를 자동 추정했다고 가정하지 않음 |
| 매장 조건 | 진열 구역과 꺼내는 순서 규칙을 미리 정의 | 매장 친화성의 기준이 실험마다 바뀌지 않도록 함 |

### 비교할 알고리즘과 평가 순서

탐욕적 배치(Greedy), 현재 Look-ahead, MCTS 후보를 **같은 박스 생성기·실제 도착 순서·후보 생성·물리 및 로봇 제약·계산시간** 아래에서 비교한다. MCTS는 추가 실험 후보이며, 이번 산업 자료나 기존 프로젝트 기록만으로 팔레트 절감이 입증된 방법은 아니다.

평가 우선순위는 다음과 같다.

1. **정확한 주문 전량 처리:** 빠진 상자, 잘못된 매장·품목, 하중·충돌 등 강제 제약 위반을 먼저 확인한다.
2. **사용 팔레트 수와 적재 품질:** 적재율만 높이고 물량을 남기는 해를 좋은 결과로 취급하지 않는다.
3. **매장 작업 대리 지표:** 정해진 하역·진열 규칙 아래의 재취급 수 또는 통로 전환 횟수를 측정한다. 사람을 대상으로 측정하지 않았다면 실제 작업시간 절감이라고 부르지 않는다.
4. **계산시간:** 평균·95백분위수·기한 초과 횟수를 함께 기록한다. 시간 초과로 미처리된 물량과 물리적으로 놓을 수 없어 거부한 물량을 분리한다.
5. **운영 자원:** 버퍼 점유, 팔레트 교체, 별도 처리 이벤트를 함께 보여준다. 유연성이 추가될 때 설치 공간이나 복잡성도 바뀔 수 있다.

로봇의 왕복 사이클이 7초라고 해서 계획기를 7초 동안 돌릴 수 있다는 뜻은 아니다. 다음 박스 정보를 언제 얻는지, 현재 동작과 계획을 겹칠 수 있는지, 명령 전달·최종 검사에 얼마나 남겨야 하는지에 따라 결정 기한이 달라진다. 계산 예산을 여러 값으로 시험할 수는 있지만, 그 값을 현장 측정으로 확보했다고 표현하지 않는다.

### 데모로 보여줄 수 있는 상황

- 무거운 생수·세제 상자와 압궤에 약한 과자 상자가 섞인 입력에서, 허용 상부 하중을 지키며 전량 처리하는지 보여준다.
- 크기가 같아도 진열 구역이 다른 상자를 넣어, 밀도와 매장 재취급 사이의 차이를 비교한다.
- 동일 주문에 도착 순서만 바꾸어 기준 방식과 제안 방식의 팔레트 수·미처리·계산시간 분포를 보여준다.
- 규정이 허용하면 버퍼 0개와 작은 버퍼를 나란히 두어, 알고리즘 변경과 순서 선택권 증가의 효과를 구분한다.

포장 변형 예측이나 만능 그리퍼까지 한 번에 포함하면, 적재 판단의 효과를 확인하기 어려워진다. 해커톤에서는 위의 좁은 조건에서 재현 가능한 비교 결과를 만드는 것이 우선이다. 이는 팀 범위에 대한 제안이며 산업 전체의 미해결 기술이라고 주장하지 않는다.

### 현장 멘토에게 확인할 질문

1. 대상 센터는 매장 주문 전체를 언제 알며, 실제 박스 투입 순서를 바꿀 수 있는가?
2. 한 셀에서 동시에 몇 매장·몇 팔레트를 처리하고, 임시 버퍼 몇 칸까지 허용되는가?
3. 실제 문제가 추가 팔레트, 사람의 재취급, 설비 정지, 매장 진열 중 어느 비용으로 가장 크게 나타나는가?
4. 자동 취급 불가 품목을 어떤 기준으로 우회하며, 물성·포장 품질 정보는 어디에 있는가?
5. 다음 박스 정보가 제공되는 시점과 배치 명령 마감 시점은 언제인가?

## 7. 참고자료의 날짜와 확인 범위

아래 모든 자료의 최종 확인일은 **2026-10-09**이다. 게시일이 보이지 않는 페이지는 확인일을 게시일처럼 쓰지 않았다.

| 자료 | 발행·사건 날짜 | 활용 범위 |
|---|---|---|
| [CMES AW 2026 솔루션 소개](https://blog.cmesrobotics.ai/aw2026-cmes-solution) | 2026-02-26 | 7종 박스·자체 버퍼·자동 패턴 |
| [CMES AW 2026 현장 스케치](https://blog.cmesrobotics.ai/cmes-aw2026) | 2026-03-04 | 국내 전시 시연 |
| [CMES IMTS 후기 및 PACK EXPO 예고](https://blog.cmesrobotics.ai/imts-autonomous-manufacturing) | 2026-10-01 | 미국 첫 공개 예정 |
| [PACK EXPO International 공식 일정](https://www.packexpointernational.com/the-show) | 개최 2026-10-18~21 | 개최 전·후 구분 |
| [Progressive Mixed Palletizing](https://progressiverobotics.ai/mixed-palletizing/) | 게시일 미표기 | 랜덤 공급 대응 제품 주장 |
| [Photoneo/Jacobi 기술 글](https://www.photoneo.com/jacobi-robotics-partnership-mixed-case-palletizing/) | 2026-02-03 | 스캐너 위치·버퍼·WMS·검증 구성 |
| [Mujin TRUSCO 도입 사례](https://mujin-corp.com/resources/blog/on-the-fly-mixed-sku-palletizing-at-trusco-nakayama-s-flagship-distribution-center-an-innovative-leap-forward) | 게시일 미표기 | 실명 운영 사례·데이터 입력 |
| [Mujin MODEX 2026 보고](https://mujin-corp.com/resources/blog/mujin-modex-2026-physical-ai-at-work) | 전시 2026-04-13~16, 게시일 미표기 | 노티칭·멀티픽 시연 |
| [Jacobi/Delta 도입 사례](https://jacobirobotics.com/case-study/deployment-with-delta-tech) | 게시 2026-01-13, 시운전 2025년 4분기 | 사전 정렬 없는 실제 운영 보고 |
| [CJ대한통운 이동형 팔레타이저](https://www.cjlogistics.com/ko/newsroom/news/NR_00001260) | 2025-07-17 | 최대 4개·실제 2개 도시·회전형 버퍼 |
| [AmbiStack Inbound 가이드](https://www.ambirobotics.com/wp-content/uploads/AmbiStack_Solution-Guide_v1.pdf) | 게시일 미표기 | 그리퍼·스캔·갠트리·제품 구성 |
| [Ambi/Pickle 공동 통합 발표](https://www.ambirobotics.com/media/physical-ai-inbound-logistics/) | 2026-06-30 | 하역·적재 역할 분담과 상업 통합 발표 |
| [Schmalz SPZ-MC](https://www.schmalz.com/en-de/products/automation-743270/vacuum-grippers-746238/gripping-systems-and-end-of-arm-tooling-eoat-746240/layer-gripping-systems-398095/modular-layer-gripper-spz-mc-398096) | 게시일 미표기 | 복합 그리퍼의 실제 제품 예시; 층 단위 취급 |

조사 한계: 원시 운전 로그·계약 가격·독립 성능시험·국내 대형마트 전체 도입률은 이번 자료에서 확보하지 못했다. 접근이 막힌 CMES의 옛 링크는 그대로 증거로 인용하지 않고 공식 블로그와 현재 제품 색인으로 대체했다.
