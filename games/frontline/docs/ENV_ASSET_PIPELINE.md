# 환경 에셋 파이프라인 (Blender → GLB → Three.js) — P3-0

환경의 큰 구조물(건물 등)은 **Blender 에서 만든 시각 모델(.glb)** 로, 반복되는 소품·단순 구조물은 기존 `shared/maps/parts.js` 로 만든다. 둘은 같은 맵에서 함께 쓴다.

핵심 약속: **GLB 는 눈에 보이는 모양일 뿐이다. 충돌·총알·스폰·서버 동기화는 이전과 똑같이 맵 데이터의 박스가 맡는다.**

## 1. 흐름

```
tools/blender/warehouse/textures.py       절차적 텍스처 (PNG/JPEG, numpy)
tools/blender/warehouse/build_warehouse.py  Blender(bpy) 로 모델링 → content/assets/warehouse.glb
tools/blender/warehouse/check_fit.py        내보낸 GLB 를 다시 불러와 충돌 박스와 맞는지 검사
content/assets/index.json                   등록 목록 (id 배열)
content/maps/outpost.json                   { type: 'asset', id: 'warehouse', x, z } 로 배치 + 건물에 replacedBy
client/js/mapassets.js                      시작할 때 GLB 를 불러둔다 (실패해도 게임은 계속)
client/js/world.js setMap                   모델의 위치를 구워 넣고 mapGroup 에 올린다
```

만드는 법 (헤드리스, Blender 앱 없이): `pip install bpy` 후

```
cd tools/blender/warehouse
python3 textures.py /tmp/wh_tex
python3 build_warehouse.py ../../../content/assets/warehouse.glb --tex /tmp/wh_tex
node -e "<check_fit.py 머리말의 한 줄>" > /tmp/wh_colliders.json   # 충돌 박스 뽑기
python3 check_fit.py ../../../content/assets/warehouse.glb /tmp/wh_colliders.json
```

Blender 앱에서는 Scripting 탭에서 `build_warehouse.py` 를 열어 실행해도 된다 (맨 위 `OUT`, `TEX` 경로만 고친다).
원본 `.blend` 는 두지 않는다 — 스크립트가 원본이다 (치수가 코드로 남아 충돌 박스와 같은 값을 쓴다).

## 2. 규칙

| 항목 | 규칙 |
|---|---|
| 단위·축 | 1 = 1 m. glTF Y-up 으로 내보내 게임 좌표(x 동, y 위, z 북)와 그대로 맞는다 |
| 원점 | 건물 가운데 바닥. 맵 데이터의 `x, z` 가 곧 건물 중심 (`y` 로 띄울 수 있다) |
| 회전·크기 | 맵 데이터 `rot`(0/90/180/270), `s`(배율), `sym`(맵 중심 대칭, 180° 돌려 하나 더) |
| 재질 | PBR 표준(KHR 확장 없음). 이름: Concrete · PaintedMetal · BareMetal · Wood · Glass. 최대 6개 |
| 텍스처 | 기본색(JPEG) + 법선 + ORM(R 가림, G 거칠기, B 금속성). 한 장 512px 이하, 합계 1.2 MB 이하 |
| 색 | 칠하는 색은 **정점색**(COLOR_0)으로 준다 → 텍스처는 중립색이고 재질을 늘리지 않고도 부분마다 색이 다르다. 팔레트는 `ENV_ART_BIBLE.md` |
| UV | 월드 좌표 평면 투영 (타일 크기는 면마다). 이웃한 상자끼리 무늬가 이어진다 |
| 그림자 | 메쉬 이름이 `NS_` 로 시작하면 그림자를 안 던진다 (얇은 틀·손잡이·작은 장식). 맵 데이터 `shadow: 'none'` 이면 모델 전체가 안 던진다. 받기는 항상 한다. 유리(투명)는 던지지도 받지도 않는다 |
| 합치기 | 재질 × 그림자 설정 별로 한 메쉬 (창고 7개). 위치를 구워 넣은 지오메트리라 P1-6 그림자 컬(`userData.cs`)이 그대로 동작한다 |
| 예산 (테스트로 강제) | 삼각형 12 000 · 파일 2 MB · 재질 6 · 메쉬 10 · 투명 재질 1 · 노드 변환 없음 |

## 3. 충돌과 시각 모델이 어긋나지 않게

- 맵 데이터의 **건물(`building`) 은 그대로** 두고 `replacedBy: '<id>'` 만 붙인다. 충돌 박스(벽 28개 + 지붕판)는 이전과 byte 단위로 같다 (`tests/assets.test.mjs`).
- 모델 쪽 약속 (`check_fit.py` 가 잰다):
  1. 덮임 — 충돌 박스 안의 점은 모두 시각 표면에서 (두께의 절반 + 0.08 m) 안에 있다. 구멍이 없다.
  2. 구멍 — 문·창 구멍은 시각 모델에서도 비어 있다 (틀·가운데 살·유리 조각 말고는 막지 않는다: 문 10 % · 창 22 % 이하).
  3. 돌출 — 몸 높이(y < 2.4)에서는 충돌 겉면 밖으로 0.16 m 넘게 나오지 않는다. 문 위 캐노피처럼 머리 위(2.5 m 이상)는 1 m 까지 가능.
  4. 겹침 — 같은 방향·같은 평면(2 mm)에서 겹치는 면이 없다 (z-fighting). 같은 재질·같은 색의 겹침은 무방.
- 창은 **구멍 그대로**(총알 통과) 두고, 깨져 남은 유리 조각만 둔다. 온전한 유리를 구멍에 끼우면 "보이는데 총알은 통과" 가 되기 때문이다. 온전한 유리는 충돌 벽이 있는 곳(높은 유리띠)에만 쓴다.
- 문은 열린 채(구멍 그대로)이고, 문짝은 바깥벽에 완전히 접혀 붙어 있다 (벽에서 0.1 m).

## 4. 실패해도 게임은 돌아간다

GLB 를 못 불러오면 `mapassets.js` 가 경고만 하고 건너뛴다. `world.js` 는 `replacedBy` 가 가리키는 모델이 **불러와진 경우에만** 그 건물의 박스 모양을 건너뛴다 → 못 불러오면 예전 박스 건물이 그대로 보인다. 서버는 이 모델을 아예 읽지 않는다 (`layout.assets` 는 클라이언트 전용).

## 5. 맵 에디터

`asset` 은 스튜디오 맵 에디터의 물체 종류에 나온다 (id·x·z·y·선택 상자 크기·배율·그림자). 안 보이는 선택 박스(충돌 없음)를 내서 클릭으로 집을 수 있다. 모델 자체는 에디터에서도 보인다 (같은 `world.setMap`).

## 6. 여러 에셋 (P3-3)

| 에셋 | 맵 위치 | 대신하는 물체 | 스크립트 |
|---|---|---|---|
| warehouse | outpost (31, 0) | building | `tools/blender/warehouse/build_warehouse.py` |
| watchtower | outpost (−47, 0) | tower | `tools/blender/env/build_watchtower.py` |
| centerdeck | outpost (0, 0) | platform · ramp 2 · stairs 2 · 난간 box 4 | `tools/blender/env/build_centerdeck.py` |

- **공통 도구** `tools/blender/env/envkit.py`: 상자·막대·원기둥·다각형 기둥(prism), 재질 묶음(C·P·PN·M_·MN·WD·WDS·GL), 재질 만들기, 내보내기. 모든 에셋이 같은 `make_materials()` 와 같은 `textures.py` 출력을 쓴다.
- **재질 공유**: 게임은 같은 이름 재질을 모델끼리 하나로 쓴다 (`client/js/mapassets.js shareMaterials`). 그래서 GPU 텍스처는 모델 수만큼 늘지 않는다. `tests/assets.test.mjs` 가 같은 이름 재질의 계수·텍스처 바이트가 같은지 확인한다 (다르면 실패).
- **그리기 호출**: 모델 메쉬도 절차적 박스와 같은 경로(`world.js emit`)로 (재질 × 그림자 × 40 m 칸) 묶음에 합친다. 모델이 늘어도 같은 칸·같은 재질이면 그리기 호출이 늘지 않는다. P1-6 그림자 컬(`userData.cs`)도 그대로.
- **여러 물체를 한 모델이**: `replacedBy` 는 모든 물체 종류에 붙일 수 있다. 그 물체의 박스는 모두 모델의 선택 상자(asset 의 w·d) 안에 있어야 한다 (테스트).
- **충돌 박스 뽑기**: `node tools/blender/env/colliders.mjs outpost <id> > /tmp/<id>_col.json` (경사로는 7번째 칸 `{axis, up}`).
- **맞춤 검사** (`check_fit.py`): 속이 꽉 찬 계단·경사로·발판은 `--surface` (충돌 겉면 점 → 시각 표면 0.1 m 이내, 맞닿은 면은 뺀다), 2층 바닥이 있으면 `--zones 0:2.4,<바닥>:<바닥+1.8>`.
  ```
  python3 check_fit.py watchtower.glb /tmp/watchtower_col.json --surface --zones 0:2.4,3.2:5.0
  python3 check_fit.py centerdeck.glb /tmp/centerdeck_col.json --surface --zones 0:2.4,2.4:4.2
  ```

## 7. 새 에셋 추가 순서

1. `tools/blender/env/build_<이름>.py` 를 `build_watchtower.py` 처럼 만든다 (`from envkit import *`, 치수는 충돌 박스에서 옮겨 적는다).
2. `content/assets/<id>.glb` 를 내보내고 `content/assets/index.json` 에 id 를 넣는다.
3. 맵 데이터에 `{ type: 'asset', id, x, z, w, d, h }` 를 넣고, 가려질 물체마다 `replacedBy: id`.
4. `colliders.mjs` → `check_fit.py` → `node tests/assets.test.mjs` → 실제 화면에서 기존과 같은 카메라로 비교.
