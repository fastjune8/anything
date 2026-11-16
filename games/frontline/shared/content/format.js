// 콘텐츠 JSON 을 사람이 읽고 git 에서 비교하기 좋은 모양으로 쓴다.
// 맨 위 칸은 한 줄에 하나씩, 목록(배열) 안의 항목은 한 줄에 하나씩 (물체 하나 = 한 줄 → 변경 내역이 깔끔하다).
const one = v => JSON.stringify(v);

function block(value, indent) {
  const pad = ' '.repeat(indent), inner = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every(v => v === null || typeof v !== 'object')) return one(value); // 숫자 목록 등은 한 줄
    return '[\n' + value.map(v => inner + one(v)).join(',\n') + '\n' + pad + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(k => `${inner}${one(k)}: ${block(value[k], indent + 2)}`).join(',\n') + '\n' + pad + '}';
  }
  return one(value);
}

export function formatContent(value) { return block(value, 0) + '\n'; }
