# 옷 GLB 내보내기

## 한 줄
```python
G['export_garment']([obj], '<id>', '<슬롯>', out_dir='<repo>/games/frontline/content/wearables')            # 3인칭
G['export_garment']([obj_fp], '<id>', '<슬롯>', fp=True, out_dir=...)                                         # 1인칭 (파일명 끝 _fp)
```
내부는 `frontier_wear.export_wearable` (사람이 직접 `bpy.ops.export_scene.gltf` 를 부를 때도 같은 설정):

| 설정 | 값 | 이유 |
|---|---|---|
| `use_selection` | 아마추어 + 그 옷만 | 몸·무기·참고 이미지가 안 들어가게 |
| `export_skins` | True | 가중치·관절 |
| `export_def_bones` | **False** (전체 뼈) | 관절 목록이 몸과 같아져 몸의 Skeleton 을 공유한다 (`outfit.js sameSkeleton`) 그리고 `cosmetics.test.mjs` 규칙을 통과한다 |
| `export_yup` | True | glTF |
| `export_animations` | False | 옷 GLB 에 클립 없음 |
| `export_attributes` | True | 정점 속성 |
| 자세 | REST 로 바꿔서 | 역바인드 행렬이 몸과 같게 |
| 1인칭 | 아마추어 위치를 (0,0,0) 으로 잠깐 옮김 | 뷰모델 아마추어가 장면 어딘가에 놓여 있기 때문 |

## 지켜지는 것 (실제 확인)
- 원래 뼈대: 관절 이름이 몸의 뼈 이름 → `validate_garment.mjs` skeleton / bind-pose 검사
- 가중치: JOINTS_0/WEIGHTS_0, 4개, 합 1 → 같은 도구 weights 검사 (몸이 아닌 임의 GLB 에도 작동)
- 재질: 색 칸 이름만, 텍스처 없음
- 이름: Blender 물체 이름이 GLB 노드 이름으로 남는다. 게임은 같은 노드에서 나온 재질별 primitive 를 한 부품으로 합친다 (`prepareWearable`)
- 자동 실행: `export_garment` 가 점검→내보내기→재검증을 한 번에 하고 보고서 `<파일>.report.json` 을 남긴다. 수동 내보내기도 가능하지만 점검이 빠진다.

## 내보낸 뒤
1. `node tools/validate_garment.mjs <파일> --slot <슬롯> [--fp]` (fail 이면 종료 코드 1)
2. `cosmetics.json` 수정 → `node tests/cosmetics.test.mjs && node tests/garment.test.mjs`
3. 게임에서: `python3 tools/qa/garment_bind_check.py wearables/<파일>.glb <슬롯>`

## 흔한 실패
| 증상 | 원인 | 해결 |
|---|---|---|
| `no skin` | 아마추어를 같이 선택하지 않음 | `export_garment` 사용 |
| `bind-pose` | 포즈 모드/액션 상태에서 내보냄 | REST 로 |
| `skeleton` 캐릭터에 없는 뼈 | 새 뼈를 만들었거나 이름을 바꿈 | 새 뼈 금지 |
| 옷이 안 입혀짐 (콘솔 "캐릭터에 없는 뼈") | 위와 같음 | 같음 |
| `materials` | 재질 이름이 색 칸이 아님 | `fabric` 등으로 |
| 텍스처가 안 보임 | 게임은 텍스처를 쓰지 않음 | 규격 §4 |
