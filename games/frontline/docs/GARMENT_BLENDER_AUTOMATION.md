# Blender 자동화 안내 (`tools/blender/garment_pipeline.py`)

**모델링을 대신하지 않는다.** 직접 만든 옷을 검사하고, 가중치·합치기·내보내기를 돕는다. 몸을 부풀려 옷을 만드는 일은 기존 `frontier_wear.py` 의 `garment` 가 따로 한다 (지우지 않았다).
읽기만 하는 함수 외에 장면을 바꾸는 함수는 `ensure_structure` `weights_from_body` `join_pieces` `export_garment` 넷뿐이다.

```python
G = {}; exec(open('<repo>/games/frontline/tools/blender/garment_pipeline.py', encoding='utf-8').read(), G)
G['init']('<repo>/games/frontline')           # frontier_wear.py 를 G['W'] 로 불러온다
```

| 함수 | 하는 일 | 장면을 바꾸나 |
|---|---|---|
| `inspect_scene()` | 모든 물체의 종류·부모·컬렉션·모디파이어·버텍스 그룹·삼각형·재질·UV 표 | 아니오 |
| `check_naming(obj, slot, fp)` | 이름 규칙, `_fp` 일치, WEAR_ 컬렉션 | 아니오 |
| `check_transforms(obj, fp)` | 스케일/회전, 아마추어 부모, 몸 크기와 비교 | 아니오 |
| `check_geometry(obj, fp)` | 떠 있는 정점, 넓이 0 면, 3면 공유 모서리, n-각형, 겹친 정점, 뒤집힌 법선(조각별 판정) | 아니오 |
| `check_materials(obj)` | 빈 슬롯, 색 칸 이름, 안 쓰는 슬롯, UV·텍스처 안내 | 아니오 |
| `clearance(obj, fp)` / `check_clearance` | 몸 표면까지 부호 있는 거리 (REST 에서) | 아니오 (REST 로 잠깐 바꿨다 되돌림) |
| `weight_stats(obj)` | 정점당 영향 뼈 수 분포, 쓰인 뼈 | 아니오 |
| `check_garment(obj, slot, fp)` | 위 전부 + `frontier_wear.check_wearable`(아마추어·변형 뼈·≤4·합 1·예산) → `{'issues', 'tris', 'clearance', 'weights', 'fails', 'warns'}` | 아니오 |
| `deform_test(obj, slot, fp)` | 관절을 돌려 몸 파묻힘·모서리 늘어남 측정 (액션·자세·포즈 모드를 끝나면 모두 되돌림) | 아니오 |
| `summarize(result)` | 이슈를 심각한 순으로 한 줄씩 | 아니오 |
| `ensure_structure(set)` | `WEAR_<set>/{MESH,HARD,REF,EXPORT}` + 색 칸 재질 | 예 |
| `weights_from_body(obj, fp)` | 몸 가중치 → 옷 (가장 가까운 3정점 섞기, 4개 제한, 이웃 평균) — 그룹을 새로 만든다 | 예 |
| `join_pieces(pieces, name, coll)` | 복사본을 합쳐 한 메시로 (원본 유지) | 예 (새 물체) |
| `export_garment(objs, id, slot, ...)` | 검사 → GLB → 다시 읽어 확인 → 보고서 JSON | 파일만 씀 |

## 판정 단계
`fail` (내보내기 거부) / `warn` (사람이 판단) / `ok`. 예: 삼각형 초과·재질 이름·4개 초과 영향·몸 안 파묻힘 1 %↑ = fail. n-각형·3 mm 미만 간격 = warn.

## 확인된 것 (이 저장소에서 실제로 돌려 본 결과, 2026-11-19)
- 기존 V.3 옷 6벌에 `check_garment` 를 돌려 실제 지적을 얻었다: 부츠 넓이 0 면 4개, 장갑·바지 3면 공유 모서리, 재킷 별도 조각 하나가 몸을 향함, 장갑은 몸과 3 mm 미만 정점이 많음 (모두 현재 게임에서는 보이는 문제가 아님 — 생성기가 만든 겹침/잔여물).
- `deform_test`: 바지·재킷·장갑에서 "몸이 2배 이하로 늘어나는 자세에서 옷 모서리가 3–8배 늘어남" 이 나옴 (바지 무릎 3 mm 모서리가 8배). 실제 지적이며 V.3 의 무릎 쪽 모서리는 손볼 후보.
- `weights_from_body` + `join_pieces` + `ensure_structure`: 부츠 복사본으로 시험, 만들어진 가중치는 `check_wearable` 통과, 합친 메시의 정점 수 = 합, 시험 후 장면 원상 복구.
- `export_garment`: 넓이 0 면을 지운 부츠 복사본은 내보내져 `…_v_1.glb`, 다시 부르면 `…_v_2.glb`, `version=1` 을 강제하면 덮어쓰기를 거부. 내보낸 GLB 는 `tools/validate_garment.mjs` 통과.
- **시험하지 않은 것**: 1인칭(`fp=True`)용 `export_garment`, `deform_test` 의 1인칭 뼈 이름, 손으로 모델링한 진짜 옷 (이 저장소에는 아직 없다).

## 알려진 한계
- `deform_test` 의 몸 겹침은 "가장 가까운 몸 표면" 기준이라 다리 사이처럼 몸의 다른 부분이 가까우면 잘못 셀 수 있다 → 비율이 낮을 때는 경고로 본다.
- 뼈 축 방향(roll)을 몰라 X/Y/Z 를 모두 돌려 본다 (Y = 뼈 길이 방향은 비틀기 1/3 각도만).
- 장면에 액션(`TP_Rifle_Aim` 등)이 걸려 있어도 시험 동안만 떼어 두고 되돌린다.
