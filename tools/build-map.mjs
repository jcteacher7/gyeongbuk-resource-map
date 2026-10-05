// 경북 22개 시군 지도 파일(data/gyeongbuk-map.js)을 만드는 도구입니다.
// 앱이 쓰는 것은 결과 파일뿐이라, 이 도구는 지도를 다시 만들 때만 씁니다.
// 쓰는 방법은 tools/README.md 를 보세요.
import { readFileSync, writeFileSync } from 'node:fs';
import polylabel from 'polylabel';

const [, , mainPath, ulleungPath, outPath] = process.argv;
const main = JSON.parse(readFileSync(mainPath, 'utf8'));
const ulleung = JSON.parse(readFileSync(ulleungPath, 'utf8'));

const NAMES = {
  37010: '포항시', 37020: '경주시', 37030: '김천시', 37040: '안동시', 37050: '구미시',
  37060: '영주시', 37070: '영천시', 37080: '상주시', 37090: '문경시', 37100: '경산시',
  37320: '의성군', 37330: '청송군', 37340: '영양군', 37350: '영덕군', 37360: '청도군',
  37370: '고령군', 37380: '성주군', 37390: '칠곡군', 37400: '예천군', 37410: '봉화군',
  37420: '울진군', 37430: '울릉군',
};
const NB_NAMES = { nb22: '대구', nb26: '울산', nb32: '강원', nb33: '충북', nb35: '전북', nb38: '경남' };

// 단순 평면 투영: 위도 36.5도 기준
const LON0 = 127.55, LAT0 = 37.32, K = 400, COS = Math.cos(36.5 * Math.PI / 180);
const px = ([lon, lat]) => [(lon - LON0) * COS * K, (LAT0 - lat) * K];
const r1 = (v) => Math.round(v * 10) / 10;

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

function ringPath(ring, tf) {
  const pts = ring.map(tf);
  let d = '';
  let prev = null;
  pts.forEach((p, i) => {
    const q = [r1(p[0]), r1(p[1])];
    if (prev && q[0] === prev[0] && q[1] === prev[1] && i !== pts.length - 1) return;
    d += (i === 0 ? 'M' : 'L') + q[0] + ' ' + q[1];
    prev = q;
  });
  return d + 'Z';
}
const area = (ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
};

function shape(geom, tf = px) {
  const polys = polysOf(geom).map((poly) => poly.map((ring) => ring.map(tf)));
  const d = polysOf(geom).map((poly) => poly.map((ring) => ringPath(ring, tf)).join('')).join('');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  polys.forEach((poly) => poly[0].forEach(([x, y]) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }));
  const biggest = polys.slice().sort((a, b) => area(b[0]) - area(a[0]))[0];
  const lab = polylabel(biggest, 0.5);
  return { d, bbox: [x0, y0, x1, y1].map(r1), label: [r1(lab[0]), r1(lab[1])] };
}

const regions = [];
const neighbors = [];
for (const f of main.features) {
  const gid = f.properties.gid;
  if (gid.startsWith('nb')) {
    neighbors.push({ id: gid, name: NB_NAMES[gid] || '', ...shape(f.geometry) });
  } else {
    regions.push({ id: +gid, name: NAMES[gid], ...shape(f.geometry) });
  }
}

// 울릉군: 동해 쪽 점선 상자 안에 옮겨 그린다(작은 지도 안의 지도).
// 울릉도는 원래보다 2.2배, 독도는 울릉도 오른쪽 아래로 옮겨 8배로 그린다.
const [bx, by] = px([129.68, 36.98]);
const [bx2, by2] = px([130.06, 36.50]);
const box = [r1(bx), r1(by), r1(bx2 - bx), r1(by2 - by)];
const ULL_S = 2.2, DOK_S = 8;
const ullTf = ([lon, lat]) => {
  const [x, y] = px([lon, lat]);
  const [cx, cy] = px([130.857, 37.50]);
  return [bx + box[2] * 0.42 + (x - cx) * ULL_S, by + box[3] * 0.40 + (y - cy) * ULL_S];
};
const dokTf = ([lon, lat]) => {
  const [x, y] = px([lon, lat]);
  const [cx, cy] = px([131.867, 37.241]);
  return [bx + box[2] * 0.80 + (x - cx) * DOK_S, by + box[3] * 0.64 + (y - cy) * DOK_S];
};
const ullParts = ulleung.features.map((f) => {
  const lon = polysOf(f.geometry)[0][0][0][0];
  return shape(f.geometry, lon > 131 ? dokTf : ullTf);
});
const main4 = ullParts[4];
const dokParts = ullParts.filter((_, i) => i < 2);
let dx0 = Infinity, dy0 = Infinity, dx1 = -Infinity, dy1 = -Infinity;
dokParts.forEach((p) => { dx0 = Math.min(dx0, p.bbox[0]); dy0 = Math.min(dy0, p.bbox[1]); dx1 = Math.max(dx1, p.bbox[2]); dy1 = Math.max(dy1, p.bbox[3]); });
regions.push({
  id: 37430,
  name: NAMES[37430],
  d: ullParts.map((p) => p.d).join(''),
  bbox: box.length && [box[0], box[1], r1(box[0] + box[2]), r1(box[1] + box[3])],
  label: main4.label,
  inset: {
    box,
    dokdo: [r1((dx0 + dx1) / 2), r1(dy1)],
    note: '위치와 크기를 바꿔 그렸어요',
    dokdoNote: '독도: 울릉도에서 동쪽으로 약 87km',
  },
});

regions.sort((a, b) => a.id - b.id);
if (regions.length !== 22) throw new Error('시군이 22개가 아닙니다: ' + regions.length);

// 처음 크기: 경북(본토 + 울릉 상자)이 꼭 들어가는 범위
let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
regions.forEach(({ bbox: [a, b, c, d] }) => { gx0 = Math.min(gx0, a); gy0 = Math.min(gy0, b); gx1 = Math.max(gx1, c); gy1 = Math.max(gy1, d); });
const [w, h] = px([130.10, 35.40]);

const out = {
  source: '지도 자료: 통계청 통계지리정보서비스(SGIS), 공공누리 제1유형 (2018년 12월 기준, 군위군은 대구로 반영)',
  size: [r1(w), r1(h)],
  home: [gx0, gy0, gx1, gy1].map(r1),
  regions,
  neighbors,
};
const js = '// 이 파일은 tools/build-map.mjs 가 만든 결과입니다. 손으로 고치지 마세요.\n' +
  '// ' + out.source + '\n' +
  'export default ' + JSON.stringify(out) + ';\n';
writeFileSync(outPath, js);
console.log('시군', regions.length, '이웃', neighbors.length, '크기', (js.length / 1024).toFixed(1) + 'KB');
