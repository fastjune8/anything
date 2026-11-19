// 옷 제작 파이프라인 검증기 테스트: 지금 옷들이 규칙을 통과하고, 고장 낸 옷은 규칙이 잡아내는지
import fs from 'node:fs';
import path from 'node:path';
import { check, failed, ROOT } from './helpers.mjs';
import { parseGlb, readAccessor, validateGarment, failsOf, jointNames, loadBody } from '../tools/validate_garment.mjs';

// 검증기 시험용 옷은 tests/fixtures/garment/ (폐기한 절차적 옷의 사본). 프로덕션 카탈로그(content/cosmetics.json)는 외부 에셋이 들어올 때까지 비어 있다.
const FIX = path.join(ROOT, 'tests/fixtures/garment');
const cos = JSON.parse(fs.readFileSync(path.join(FIX, 'cosmetics.fixture.json'), 'utf8'));
const load = rel => parseGlb(fs.readFileSync(path.join(FIX, 'content', rel)));
const clone = g => ({ json: JSON.parse(JSON.stringify(g.json)), bin: Buffer.from(g.bin) });
const rules = r => failsOf(r).map(i => i.rule);

console.log('[픽스처 옷은 규칙을 통과한다]');
for (const it of cos.items) for (const [view, rel] of [['tp', it.tp], ['fp', it.fp]]) {
  if (!rel) continue;
  const r = validateGarment(load(rel), { slot: it.slot, fp: view === 'fp', mount: it.mount });
  check(failsOf(r).length === 0, `${it.id} ${view}: 검증기 통과`, failsOf(r).map(i => `${i.rule}: ${i.text}`).join(' / ') || `삼각형 ${r.stats.tris}/${r.stats.budget}`);
}

console.log('\n[고장 낸 옷은 잡는다]');
const jacketRel = cos.items.find(i => i.id === 'tactical_jacket_001').tp;
const base = load(jacketRel), opt = { slot: 'upper', fp: false, mount: 'skin' };

let g = clone(base); g.json.materials[0].name = 'shiny_red';
check(rules(validateGarment(g, opt)).includes('materials'), '색 칸이 아닌 재질 이름 → materials');

g = clone(base); g.json.textures = [{ source: 0 }];
check(rules(validateGarment(g, opt)).includes('no-textures'), '텍스처 포함 → no-textures');

g = clone(base); g.json.animations = [{ channels: [], samplers: [] }];
check(rules(validateGarment(g, opt)).includes('no-animations'), '애니메이션 포함 → no-animations');

check(rules(validateGarment(base, { ...opt, slot: 'acc1' })).includes('budget'), '예산 초과(acc1 = 1000) → budget');

g = clone(base); g.json.nodes[g.json.skins[0].joints[3]].name = 'Fake_Bone';
check(rules(validateGarment(g, opt)).includes('skeleton'), '캐릭터에 없는 뼈 이름 → skeleton');

g = clone(base); { const a = readAccessor(g, g.json.skins[0].inverseBindMatrices); const bv = g.json.bufferViews[g.json.accessors[g.json.skins[0].inverseBindMatrices].bufferView]; g.bin.writeFloatLE(a[13] + 0.2, (bv.byteOffset || 0) + (g.json.accessors[g.json.skins[0].inverseBindMatrices].byteOffset || 0) + 13 * 4); }
check(rules(validateGarment(g, opt)).includes('bind-pose'), '역바인드 행렬이 몸과 다름(다른 자세에서 내보냄) → bind-pose');

// 가중치 합이 1이 아님: WEIGHTS_0 첫 정점들을 절반으로
g = clone(base); {
  const p = g.json.meshes[0].primitives[0], acc = g.json.accessors[p.attributes.WEIGHTS_0], bv = g.json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0), stride = bv.byteStride || 16;
  if (acc.componentType === 5126) for (let v = 0; v < 200; v++) for (let k = 0; k < 4; k++) g.bin.writeFloatLE(g.bin.readFloatLE(off + v * stride + k * 4) * 0.5, off + v * stride + k * 4);
  else if (acc.componentType === 5123) for (let v = 0; v < 200; v++) for (let k = 0; k < 4; k++) g.bin.writeUInt16LE(g.bin.readUInt16LE(off + v * stride + k * 2) >> 1, off + v * stride + k * 2);
  else for (let v = 0; v < 200; v++) for (let k = 0; k < 4; k++) g.bin.writeUInt8(g.bin.readUInt8(off + v * stride + k) >> 1, off + v * stride + k);
}
check(rules(validateGarment(g, opt)).includes('weights'), '가중치 합이 1이 아님 → weights');

// 몸 안으로 파묻힘: 모든 좌표를 몸 중심 쪽으로 12cm 당긴다 (x 를 0 으로 줄인다)
g = clone(base); {
  const p = g.json.meshes[0].primitives[0], acc = g.json.accessors[p.attributes.POSITION], bv = g.json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0), stride = bv.byteStride || 12;
  for (let v = 0; v < acc.count; v++) { const o = off + v * stride; for (const k of [0, 1]) g.bin.writeFloatLE(g.bin.readFloatLE(o + k * 4) * 0.5, o + k * 4); }
}
check(rules(validateGarment(g, opt)).includes('clearance'), '몸 안쪽으로 파묻힘 → clearance');

// 뒤집힌 면: 인덱스 삼각형의 두 꼭짓점을 맞바꾼다
g = clone(base); {
  const p = g.json.meshes[0].primitives[0], acc = g.json.accessors[p.indices], bv = g.json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0), sz = acc.componentType === 5125 ? 4 : 2, rd = (o) => sz === 4 ? g.bin.readUInt32LE(o) : g.bin.readUInt16LE(o), wr = (v, o) => sz === 4 ? g.bin.writeUInt32LE(v, o) : g.bin.writeUInt16LE(v, o);
  for (let f = 0; f < acc.count; f += 3) { const a = off + (f + 1) * sz, b = off + (f + 2) * sz, x = rd(a), y = rd(b); wr(y, a); wr(x, b); }
}
check(rules(validateGarment(g, opt)).includes('winding'), '모든 면이 뒤집힘 → winding');

g = clone(base); delete g.json.skins;
check(rules(validateGarment(g, opt)).includes('skin'), '스킨 없음 → skin');

// 1인칭 규칙: 3인칭 몸의 옷을 1인칭 몸에 대어 보면 뼈대가 달라 걸린다
check(failsOf(validateGarment(base, { slot: 'upper', fp: true, mount: 'skin' })).length > 0, '3인칭 옷을 1인칭 몸 기준으로 검사하면 실패 (뼈대·바인드 자세 다름)');

console.log('\n[몸 데이터 접근]');
const tp = loadBody('tp'), fp = loadBody('fp');
check(tp.joints.length > 40 && fp.joints.length > 30 && tp.joints[0] !== undefined, `몸 GLB 뼈 수 TP ${tp.joints.length} / FP ${fp.joints.length}`);

console.log(failed() ? `\n실패 ${failed()}건` : '\n모두 통과');
process.exit(failed() ? 1 : 0);
