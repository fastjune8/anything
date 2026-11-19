"""독립 모델링 옷 GLB 의 게임 내 바인딩 검사 (실제 브라우저).

뼈 목록·순서가 몸과 달라도(= 몸의 Skeleton 을 공유하지 못해도) 캐릭터의 뼈에 이름으로 묶여 같이 움직이는지,
벗으면 기본 옷으로 돌아오는지 본다.

사용 (서버가 떠 있어야 한다. 개발: npm run dev → 포트 3002):
  python3 tools/qa/garment_bind_check.py <content/ 기준 .glb 경로> <슬롯> [포트] [기본 아이템 id]
  예) python3 tools/qa/garment_bind_check.py wearables/my_pants_001_v_1.glb lower 3002 tactical_pants_001

요구: pip install playwright, Chrome. 3인칭 옷만 검사한다 (1인칭은 별도 QA 체크리스트).
결과는 JSON 한 덩어리로 출력하고, 판정(PASS/FAIL)을 마지막 줄에 쓴다. 종료 코드 0 = PASS.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

GLB, SLOT = sys.argv[1], sys.argv[2]
PORT = sys.argv[3] if len(sys.argv) > 3 else '3002'
BASE_ID = sys.argv[4] if len(sys.argv) > 4 else None
ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
READY = 'window.__g && window.__g.joined && window.__g.me.alive'
IDLE = '() => window.__g.wear.outfitState(window.__g.localTP.outfit).pending === 0'

JS = '''async ([glb, slot, baseId]) => {
  const ca = await import('/js/charassets.js'), co = await import('/shared/cosmetics.js');
  const g = window.__g, W = g.wear, sleep = ms => new Promise(r => setTimeout(r, ms));
  const idle = async () => { while (W.outfitState(g.localTP.outfit).pending) await sleep(200); };
  const buf = await (await fetch('/content/' + glb)).arrayBuffer();
  const asset = await ca.registerWearableBuffer('tmp/bind_check.glb', buf);
  // 카탈로그가 비어 있어도(폐기 후) 쓸 수 있게: 기본 아이템이 없으면 그 칸용 임시 항목으로 바꿔 입힌다
  const base = (baseId ? co.ITEMS.get(baseId) : [...co.ITEMS.values()].find(i => i.slot === slot)) || { slot, mount: 'skin', mask: [] };
  co.ITEMS.set('tmp_bind_check', { ...base, id: 'tmp_bind_check', tp: 'tmp/bind_check.glb', fp: undefined, tmp: true });
  const out = { assetParts: asset ? asset.parts.length : 0, skinned: asset ? asset.parts[0].skinned : null, partBones: asset && asset.parts[0].boneNames ? asset.parts[0].boneNames.length : null, baseItem: base.id };
  const defaultWorn = W.outfitState(g.localTP.outfit).worn[slot];
  W.equipOutfit(slot, 'tmp_bind_check'); await sleep(800); await idle();
  const h = g.localTP.outfit, w = h.worn[slot], m = w && w.objs[0];
  if (!m) { out.error = 'equip failed'; return out; }
  const sk = m.skeleton, names = sk.bones.map(b => b.name);
  out.bones = names.length; out.bodyBones = h.inst.mask.body.skeleton.bones.length;
  out.sharedSkeleton = sk === h.inst.mask.body.skeleton;
  out.boundToCharacterBones = sk.bones.every(b => h.inst.bones.get(b.name) === b);
  // 가장 많이 묶인 뼈(몸통 뼈 제외 첫 팔다리 뼈)의 정점 하나를 골라, 그 뼈를 돌렸을 때 움직이는지
  const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; const cnt = {};
  for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0.99) { const n = names[si.getComponent(i, k)]; cnt[n] = (cnt[n] || 0) + 1; }
  const limb = Object.entries(cnt).filter(([n]) => /Arm|Leg|Hand|Foot|Shoulder/.test(n)).sort((a, b) => b[1] - a[1])[0];
  out.testBone = limb && limb[0];
  if (limb) {
    const bi = names.indexOf(limb[0]); let vi = -1;
    for (let i = 0; i < si.count && vi < 0; i++) for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi && sw.getComponent(i, k) > 0.99) { vi = i; break; }
    const pos = () => { const v = new m.position.constructor(); m.getVertexPosition(vi, v); return v.applyMatrix4(m.matrixWorld); };
    const bone = h.inst.bones.get(limb[0]), q0 = bone.quaternion.clone(); const a = pos();
    bone.rotateX(1.0); bone.updateMatrixWorld(true); const b = pos(); bone.quaternion.copy(q0); bone.updateMatrixWorld(true);
    out.movedWhenBoneRotates = +a.distanceTo(b).toFixed(3);
  }
  W.equipOutfit(slot, undefined); await sleep(300); await idle();
  const back = W.outfitState(g.localTP.outfit).worn[slot];
  out.restoredToDefault = defaultWorn ? (!!back && back.id === defaultWorn.id) : !back;   // 기본 옷이 없으면 벗었을 때 비어야 한다
  ca.forgetWearable('tmp/bind_check.glb'); co.ITEMS.delete('tmp_bind_check');
  return out;
}'''

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
        a = await br.new_page(viewport={'width': 960, 'height': 540}); errs = []
        a.on('pageerror', lambda e: errs.append(str(e)))
        await a.goto(f'http://localhost:{PORT}/?nolock&mode=ffa&tpcam&auto=alpha')
        await a.wait_for_function(READY, timeout=240000); await a.wait_for_function(IDLE, timeout=60000)
        out = await a.evaluate(JS, [GLB, SLOT, BASE_ID]); out['pageErrors'] = errs[:5]
        print(json.dumps(out, indent=1)); await br.close()
    ok = (out.get('assetParts', 0) > 0 and out.get('boundToCharacterBones') and (out.get('movedWhenBoneRotates') or 0) > 0.02 and out.get('restoredToDefault') and not errs)
    print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)

asyncio.run(main())
