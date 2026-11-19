# Blender 옷 모델링 작업 순서

목표: 독립적으로 모델링된 옷(**외부에서 구한 에셋을 가져와 이 캐릭터에 맞춘 것**, 또는 사람이 직접 만든 것)을 → 검사 → 내보내기 → 게임에서 입어 보기까지 한 줄로 잇는다.
절차적 생성(몸을 부풀리는 생성기·스크립트로 찍어낸 옷)은 더 이상 생산 방법이 아니다 — 옛 결과물은 폐기·보관됐다 (`archive/retired_garments/`). 이 문서의 도구는 외부 에셋을 가져오기·맞추기(가중치 이식)·검증·내보내기에 쓴다.

## 0. 준비 (한 번)
1. `모델링/character/hyperfps_character_rigged_V.9.blend` (또는 이후 버전)를 연다. **몸·뼈대는 건드리지 않는다.**
2. 스크립트 편집기에서:
```python
G = {}; exec(open('<repo>/games/frontline/tools/blender/garment_pipeline.py', encoding='utf-8').read(), G)
G['init']('<repo>/games/frontline')
G['ensure_structure']('<세트이름>')          # 컬렉션 4개 + 색 칸 재질
```

## 1. 모델링
1. `WEAR_<세트>_MESH` 에서 몸(Body_Mesh) 위에 옷을 만든다. 몸을 복사해 부풀리는 대신 **옷 패턴(패널·솔기·주름)에 맞춘 위상**으로 모델링한다: 솔기 위치에 에지 루프, 관절(어깨·겨드랑이·팔꿈치·손목·고관절·무릎)에 3줄 이상의 루프.
2. 두께/간격은 규격 §2. 몸이 비쳐 보이는 곳은 몸 위 6 mm 이상.
3. 단단한 조각(주머니 뚜껑·버클·패드)은 `WEAR_<세트>_HARD` 에 `<id>.hs.<이름>` 으로 따로 만든다.
4. 재질 슬롯 이름 = 색 칸. 면마다 색 칸을 칠한다 (`team` 은 팀색이 들어갈 곳).
5. 변환 적용(Ctrl+A → Scale/Rotation). 객체 이름 = 아이템 id (`tactical_jacket_002`). 1인칭용은 `_fp`, 부모 = `Viewmodel_Skeleton`.

## 2. 가중치
1. 아마추어 모디파이어 = `HyperFPS_Skeleton` (1인칭 `Viewmodel_Skeleton`).
2. `G['weights_from_body'](obj)` 로 시작값을 만들고(단단한 조각도 같은 방법), Weight Paint 로 어깨·팔꿈치·무릎·고관절을 다듬는다.
3. `G['deform_test'](obj, '<슬롯>')` 로 관절을 돌려 보고 파묻힘·늘어남 보고를 읽는다. 실패가 사라질 때까지 반복.

## 3. 합치기 (조각이 있을 때)
`G['join_pieces']([본체, 조각1, 조각2], '<id>', EXPORT컬렉션)` — 복사본을 합쳐 새 메시를 만든다 (원본은 그대로).

## 4. 검사 → 내보내기
```python
r = G['check_garment'](obj, 'upper'); print('\n'.join(G['summarize'](r)))      # fail 0 이 될 때까지
G['export_garment']([obj], 'tactical_jacket_002', 'upper', out_dir='<repo>/games/frontline/content/wearables')
```
`fail` 이 있으면 내보내지 않는다. 버전은 다음 빈 번호로 올라가고 기존 파일은 덮어쓰지 않는다. 1인칭: `fp=True` 로 한 번 더 (`<id>_fp` 객체).
(`tests/cosmetics.test.mjs` 는 스킨 옷의 관절 목록·순서가 몸과 같기를 요구한다. `export_garment` 는 전체 뼈로 내보내므로 통과한다. "변형 뼈만" 옵션으로 내보낸 GLB 도 게임에서는 입혀지지만 이 테스트는 실패한다 — 아래 통합 문서 참고.)

## 5. 파일 검증
```
node tools/validate_garment.mjs content/wearables/tactical_jacket_002_v_1.glb --slot upper
```

## 6. 등록 → 게임에서 입기
1. `content/cosmetics.json` 에 한 줄 (id·slot·tp·fp·mount·mask — `docs/CHARACTER_CUSTOMIZATION.md` §3).
2. `node tests/cosmetics.test.mjs && node tests/garment.test.mjs`
3. 스튜디오(`/studio/` → 의상) 또는 `python3 tools/qa/garment_bind_check.py wearables/<파일>.glb <슬롯>` 로 입혀 본다.
4. 애니메이션 QA: `docs/GARMENT_QA_CHECKLIST.md`.

## 버전 규칙
원본 .blend 는 덮어쓰지 않고 `<세트>_V.<n>.blend` 로 올린다. GLB 는 `<id>_v_<n>.glb` (1인칭 `_fp`). `cosmetics.json` 이 새 버전을 가리키게 바꾸고 이전 GLB 는 지우지 않는다.
