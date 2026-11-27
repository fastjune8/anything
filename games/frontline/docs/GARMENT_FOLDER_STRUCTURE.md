# 예시 폴더 구조

```
anything/
├─ 모델링/
│  ├─ character/hyperfps_character_rigged_V.9.blend      ← 승인된 몸·뼈대 (고치지 않는다)
│  └─ wearables/
│     ├─ <세트>_V.1.blend, <세트>_V.2.blend …              ← 세트 원본, 버전만 올린다
│     ├─ build_<세트>_V.<n>.py                            ← (선택) 가져오기·맞추기 보조 스크립트
│     ├─ _deprecated_procedural/                          ← 폐기한 절차적 옷의 Blender 원본·생성 스크립트 (쓰지 않음)
│     └─ _preview/                                         ← 미리보기 렌더·임시 내보내기 (게임이 읽지 않음)
└─ games/frontline/
   ├─ tools/
   │  ├─ blender/
   │  │  ├─ frontier_wear.py                               ← 몸 영역·옷 생성기·check_wearable·export_wearable (기존)
   │  │  └─ garment_pipeline.py                            ← 직접 모델링 옷의 검사·가중치·합치기·내보내기
   │  ├─ validate_garment.mjs                              ← Blender 없이 GLB 검증
   │  └─ qa/garment_bind_check.py                          ← 게임 내 바인딩 검사
   ├─ content/
   │  ├─ cosmetics.json                                    ← 아이템 한 줄씩
   │  ├─ characters/hyperfps_thirdperson_v_8.glb, hyperfps_viewmodel_v_7.glb
   │  └─ wearables/<id>_v_<n>.glb, <id>_v_<n>_fp.glb       ← 지우지 않고 쌓는다 (지금은 비어 있음: 외부 에셋 대기)
   ├─ archive/retired_garments/<날짜>_procedural/        ← 폐기한 옛 옷 GLB·카탈로그 스냅샷 (게임이 읽지 않음)
   ├─ tests/cosmetics.test.mjs, garment.test.mjs, fixtures/garment/   ← 시험용 옷 사본 (프로덕션 아님)
   └─ docs/GARMENT_*.md, CHARACTER_CUSTOMIZATION.md
```

Blender 파일 안:
```
WEAR_<세트>
 ├─ WEAR_<세트>_MESH   <id>, <id>_fp
 ├─ WEAR_<세트>_HARD   <id>.hs.<이름>
 ├─ WEAR_<세트>_REF
 └─ WEAR_<세트>_EXPORT (숨김)
```
