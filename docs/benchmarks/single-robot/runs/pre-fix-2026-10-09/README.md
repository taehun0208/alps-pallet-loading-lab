# 수정 전 실행 결과 (2026-10-09, 보존용)

검토에서 확인된 하네스 결함이 있는 상태로 실행한 결과다. **최종 비교 근거로 쓰지 않는다.** 이력 확인용으로만 보존한다.

| 파일 | 내용 | 줄 수 |
| --- | --- | ---: |
| `dev-cog-sweep.jsonl` | 개발 시드 1·2, 무게중심 가중치 탐색 (compact/compact-floor 0·20·60·150, strategy-greedy/macs 0·0.2·0.5·1.5) | 320 |
| `dev-cog-sweep-no-centre.jsonl` | 위와 같되 중앙 후보를 끈 임시 변형 (`COG_CENTER=0` 임시 코드, 이후 삭제) | 140 |
| `eval-partial-stopped.jsonl` | 평가 시드 11~15 실행. 900회 중 217회에서 중단 | 217 |

평가 실행 명령: `node work/single-robot-benchmark.mjs --phase eval --legacy 60 --strategy 1.5 --shard k/8` (8개 동시 실행). 적용한 가중치는 기록 파일에 없고, 이 실행 명령에만 남아 있다.

## 알려진 결함

- BED-BPP 주문을 `seed % 12`로 골라 개발 시드 1·2와 평가 시드 13·14가 같은 주문을 쓴다.
- `transportMarginMm`이 팔레트 외곽을 지지 영역으로 써서 박스 자체의 전도 여유보다 크게 나온다. 예: 200×200×1000 박스 단독에서 +250mm로 나오지만, 박스 자체 기준은 −50mm다.
- 기록에 정책 설정, 가중치, 시드 분리, 소스 해시가 없다.
- 버퍼 박스가 계획기의 잔여 수량에서 빠진다.
- BED 원래 순서 상황에서 `types` 배열과 ID가 입고 순서를 드러낸다.
- 작업시간에 버퍼 취급과 팔레트 교체가 빠져 있다.
- 판단시간은 8개 프로세스가 동시에 돌 때 측정한 값이다.
- 예외 사건을 주입하지 않았다.

SHA-256:

- `dev-cog-sweep.jsonl` 76f66c85a2d70ac535a397eef8ad88fc9988aca14b6966206decb7f5a009a22c
- `dev-cog-sweep-no-centre.jsonl` 334e8a9c48f1b33819319c87a48cdadd56be0d5026e86bbbbc4dbdcf1b31e7fd
- `eval-partial-stopped.jsonl` 8afc0529d5245c443355bc684446e25295d230a0e31884f7a0b08cf30be69902
