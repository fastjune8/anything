// 의상 이름표 (홈과 의상 화면이 같이 쓴다). 가벼운 모듈: 캐릭터 모델을 불러오는 코드는 들어 있지 않다.
export const SLOT_LABEL = { head: '머리 장비', hair: '머리카락', upper: '상의', lower: '하의', hands: '장갑', feet: '신발', back: '등 · 가방', waist: '허리', acc1: '소품 1', acc2: '소품 2' };
const PART = { head: '머리', neck: '목', chest: '가슴', abdomen: '배', pelvis: '골반', shoulder: '어깨', upperarm: '윗팔', forearm: '팔뚝', hand: '손', thigh: '허벅지', shin: '정강이', foot: '발' };
// 몸 영역 id → 한글 (예: upperarm_l → 왼윗팔)
export const regionName = r => { const m = r.match(/^(.+)_([lr])$/); return m ? `${m[2] === 'l' ? '왼' : '오른'}${PART[m[1]] || m[1]}` : PART[r] || r; };
