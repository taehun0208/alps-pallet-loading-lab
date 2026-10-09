import { AREAS, AREA_NAMES } from './model';
import type { Aggregate } from './model';
import { getAlgorithm } from './registry';

const xy = (i: number, n: number) => [180 + Math.sin(i * Math.PI / 3) * 110 * n / 100, 150 - Math.cos(i * Math.PI / 3) * 110 * n / 100];
const measured = (n: number | null): n is number => n !== null && Number.isFinite(n);

export function Radar({ data }: { data: Aggregate[] }) {
  const series = data.slice(0, 6);
  return <svg className="bench-radar" viewBox="0 0 360 330" role="img" aria-label="6개 평가 영역 비교. 육각형은 100점 기준틀입니다. 측정된 점만 연결하고, 미평가 구간은 점선으로 구분합니다. 외곽 빈 원은 미평가 표시이며 점수가 아닙니다.">
    <g className="bench-grid">
      {[25, 50, 75, 100].map(v => <polygon key={v} points={AREAS.map((_, i) => xy(i, v).join(',')).join(' ')} />)}
      {AREAS.map((_, i) => <line key={i} x1="180" y1="150" x2={xy(i, 100)[0]} y2={xy(i, 100)[1]} />)}
    </g>
    {AREAS.map((a, i) => {
      const missing = series.filter(s => !measured(s.scores[a])).length, [x, y] = xy(i, 125);
      return <g key={a} className="bench-axis-label">
        <text x={x} y={y + 4} textAnchor="middle">{AREA_NAMES[a]}</text>
        {missing > 0 && <text className="bench-null" x={x} y={y + 17} textAnchor="middle">{missing === series.length ? '미평가' : `${missing}개 미평가`}</text>}
        {series.length > 0 && missing === series.length && <circle className="bench-unmeasured" cx={xy(i, 100)[0]} cy={xy(i, 100)[1]} r="4"><title>{`${AREA_NAMES[a]} · 미평가 · 점수 아님`}</title></circle>}
      </g>;
    })}
    {series.map((a, j) => {
      const points = AREAS.flatMap((k, i) => measured(a.scores[k]) ? [{ axis: i, value: a.scores[k] as number, p: xy(i, a.scores[k] as number) }] : []);
      const full = points.length === AREAS.length;
      return <g key={a.algorithm} className={`bench-series series-${j}`}>
        {points.length >= 3 && <polygon className={`bench-fill${full ? '' : ' bench-partial'}`} points={points.map(s => s.p.join(',')).join(' ')}><title>{`${getAlgorithm(a.algorithm).name} · ${points.length}/6개 영역 측정 · 면은 측정된 점만 연결`}</title></polygon>}
        {!full && points.length >= 2 && points.slice(0, points.length === 2 ? 1 : points.length).map((s, i) => {
          const next = points[(i + 1) % points.length], gap = (next.axis - s.axis + 6) % 6 !== 1;
          return <line key={s.axis} className={gap ? 'bench-gap' : undefined} x1={s.p[0]} y1={s.p[1]} x2={next.p[0]} y2={next.p[1]}><title>{gap ? '미평가 축을 건너 연결 · 보간 점수 없음' : '측정된 영역 연결'}</title></line>;
        })}
        {points.map(s => <circle key={s.axis} cx={s.p[0]} cy={s.p[1]} r="3"><title>{`${getAlgorithm(a.algorithm).name} · ${AREA_NAMES[AREAS[s.axis]]} ${s.value.toFixed(1)}`}</title></circle>)}
      </g>;
    })}
    {series.length === 0 && <text className="bench-radar-empty" x="180" y="153" textAnchor="middle">실험 결과 없음</text>}
    <text className="bench-radar-key" x="180" y="321" textAnchor="middle">점선: 미평가 구간 · 외곽 빈 원: 미평가 표시</text>
  </svg>;
}
