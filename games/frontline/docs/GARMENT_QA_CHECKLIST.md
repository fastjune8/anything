# 옷 QA 체크리스트

새 옷마다 아래를 표에 PASS / FAIL / NOT TESTED 로 적는다. 돌리지 않은 것은 NOT TESTED 로 둔다 (통과로 적지 않는다).

## A. 자동 (명령 하나로)
| 항목 | 명령 | 기대 |
|---|---|---|
| Blender 규칙 | `G['check_garment'](obj, slot, fp)` | fail 0 |
| 관절 변형 | `G['deform_test'](obj, slot, fp)` | fail 0 |
| GLB 구조·가중치·몸 간격 | `node tools/validate_garment.mjs <glb> --slot <s> [--fp]` | 종료 0 |
| 데이터·예산 | `node tests/cosmetics.test.mjs` | 모두 통과 |
| 검증기 회귀 | `node tests/garment.test.mjs` | 모두 통과 |
| 게임 내 바인딩 | `python3 tools/qa/garment_bind_check.py <glb> <slot>` | PASS |

## B. 게임에서 눈으로 (스튜디오 의상 화면 또는 `?tpcam` + V 키)
| 항목 | 방법 |
|---|---|
| 입히기/벗기기 | 슬롯 클릭 / `__g.wear.equipOutfit(slot, null)` → 다른 슬롯 그대로, 몸 마스크 복원 |
| 같은 슬롯 교체 | 다른 옷으로 바꿨다가 되돌리기, 연속 요청 |
| 반복 교체 | 30–40회 갈아입고 `outfitState` 의 지오메트리·캐시 수가 늘지 않는지 |
| 3인칭↔1인칭 | V 키. 1인칭 팔·장갑이 카메라에 겹치지 않는지(근접 클립), 마스크 |
| 애니메이션 | idle · walk · run · sprint · jump · fall · land · aim · fire · reload · crouch · crouch-walk — 어깨·팔꿈치·무릎·엉덩이에서 찢김/파묻힘 |
| 겹옷 | 재킷+백팩+장갑 조합에서 서로 파고들지 않는지 (간격 6–8 mm) |
| 색 | 팀색(`team`), 팔레트 교체, 개인전 색 |
| 네트워크 | 두 창으로 입장해 서로의 옷이 보이는지 |
| 정리 | 벗은 뒤 메모리/`wearObjs` 수 |

## C. 기록 방식
```
옷: <id> v<n>   날짜:   검사자:
A: check_garment [ ] deform_test [ ] validate [ ] cosmetics.test [ ] garment.test [ ] bind_check [ ]
B: 입기/벗기 [ ] 교체 [ ] 반복 [ ] FP/TP [ ] 애니메이션(12) [ ] 겹옷 [ ] 색 [ ] 네트워크 [ ] 정리 [ ]
메모(FAIL/NOT TESTED 이유):
```
