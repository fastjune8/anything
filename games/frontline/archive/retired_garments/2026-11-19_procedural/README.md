# 폐기된 garment 에셋 (2026-11-19)

절차적 생성·실험적 모델링으로 만든 의상들. **프로덕션 에셋이 아니다** — 게임 카탈로그(`content/cosmetics.json`)와 기본 복장에서 뺐고,
`content/wearables/` 에서도 치웠다. 참고·되돌리기용으로만 보관한다.

- `content_wearables/` — 예전 `content/wearables/*.glb` 전부 (tactical_* v_1~v_4, fp 포함, v_4 검증 보고서)
- `catalog/cosmetics.before_retirement.json` — 폐기 직전 카탈로그(아이템 7개·기본 복장). 되살리려면 `items`·`defaults.items` 를 여기서 복사
- Blender 원본·생성 스크립트: `모델링/wearables/_deprecated_procedural/` (build_tactical_*.py, tactical_*_V.*.blend)
- 테스트 픽스처는 `tests/fixtures/garment/` 에 따로 있다 (이 폴더의 파일을 쓰지 않는다)

외부에서 구한 의상은 `content/wearables/` + `cosmetics.json` 에 새로 등록한다 (docs/GARMENT_ASSET_SPEC.md).
