import { useEffect, useMemo, useRef, useState } from 'react';
import PalletScene, { type ViewOptions } from '../PalletScene';
import { DEFAULT_ROBOT_ARM } from '../robotArm';
import { ALGORITHMS, CAPACITY_VERSION, COLORS, MODES, ZONES, defaultCapacityConfig, pairedEffect, retailScenario, selectedAlgorithm, summarizeCapacity, trialSpecs } from './experiment';
import type { CapacityConfig, CapacityTrial, Mode } from './experiment';
import './capacity.css';

const name = (id: string) => ALGORITHMS[id as keyof typeof ALGORITHMS] ?? id;
const num = (v: number | null | undefined, d = 1) => v === null || v === undefined ? '—' : v.toFixed(d);
const pct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${(100 * v).toFixed(1)}%`;
const modes = Object.keys(MODES) as Mode[];
const options: ViewOptions = { opacity: 1, outlines: true, slice: 3000, weight: false, supports: false, center: false, candidates: false, path: true, arm: true,
  armModel: { ...DEFAULT_ROBOT_ARM, baseX: -700, baseY: -500 } };
function save(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' })), a = document.createElement('a');
  a.href = url; a.download = 'single-arm-capacity.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Replay({ row, config, cursor, camera, mode }: { row?: CapacityTrial; config: CapacityConfig; cursor: number; camera: string; mode: Mode }) {
  const fallback = useMemo(() => ({ ...config.scenario, constraints: { ...config.scenario.constraints, robotMode: mode === 'space' ? 'ideal' as const : 'gripper' as const } }), [config, mode]);
  const position = Math.min(cursor, row?.total ?? 0), arrival = Math.floor(position) + 1, events = row?.trace.filter(t => t.arrival === arrival) ?? [];
  const offset = (position % 1) * events.length, event = events[Math.floor(offset)], fraction = offset % 1;
  const previous = row?.trace.filter(t => t.arrival < arrival).at(-1);
  const done = !!row && position >= row.total;
  const placed = done || (row && !row.trace.length) ? row?.placements ?? [] : event?.before ?? previous?.after ?? [];
  const moving = event?.action === 'place';
  const placedVolume = placed.reduce((n, p) => n + p.size.w * p.size.d * p.size.h, 0), p = row?.scenario.pallet ?? config.scenario.pallet;
  return <section className={`capacity-cell capacity-${mode}`} aria-label={MODES[mode]}>
    <header><h2>{MODES[mode]}</h2><span>{mode === 'space' ? '높이·지지·하중 공통' : mode === 'robot' ? '도달·가반·공구 경로 근사' : '같은 로봇 · 구역 선호 추가'}</span></header>
    <PalletScene scenario={row?.scenario ?? fallback} placements={placed} current={moving ? event.box : null} candidate={moving ? event.candidate : null} path={moving ? event.candidate?.path : null}
      motion={!!moving} progress={fraction} options={options} camera={camera} cameraVersion={0}/>
    <div className="capacity-cell-progress"><i style={{ width: `${100 * placedVolume / (p.width * p.depth * p.maxHeight)}%` }}/></div>
    <p className="capacity-step">{!row ? '비교 계산을 시작하면 적재 과정이 표시됩니다.' : done ? `${row.placements.length}개 적재 · ${row.unplaced.length}개 미적재${row.unprocessed.length ? ` · ${row.unprocessed.length}개 미처리` : ''}` : !row.trace.length ? '저장 예시는 최종 배치만 포함 · 다시 계산하면 재생 가능' : event ? `${event.box.id} · ${event.reason}` : '다음 입고 대기'}</p>
    <dl className="capacity-readings">
      <div><dt>허용 높이 기준 적재율</dt><dd>{pct(row?.utilization)}</dd></div>
      <div><dt>담은 부피 / 개수</dt><dd>{row ? `${num(row.volume / 1e9, 3)} m³ / ${row.placements.length}` : '—'}</dd></div>
      <div><dt>평균 / P95 계산</dt><dd>{row ? `${num(row.meanMs)} / ${num(row.p95Ms)} ms` : '—'}</dd></div>
      <div><dt>최대 계산 / 기한 초과</dt><dd>{row ? `${num(row.maxMs)} ms / ${row.deadlineMisses}회` : '—'}</dd></div>
      <div><dt>실제 높이 / 내부 채움</dt><dd>{row ? `${row.usedHeight} mm / ${pct(row.envelopeFill)}` : '—'}</dd></div>
      <div><dt>순수 적재 경로 시간</dt><dd>{row?.robotSeconds != null ? `${num(row.robotSeconds)} s` : '미평가'}</dd></div>
    </dl>
    {row && <div className="capacity-diagnostics">
      <p>{row.status === 'finished' ? '입고 평가 완료' : row.reason} · 확정 배치 위반 {row.violations.length}건</p>
      <p>공급 부피로 가능한 느슨한 상한 {pct(row.supplyBound)}{row.supplyBound < 1 ? ' · 전부 담아도 팔레트 용적보다 적은 물량' : ''}</p>
      <p>배치 판단 {row.decisions}회 · 합계 {num(row.computeMs)} ms · 보류 재검사 포함</p>
      <p>{mode === 'space' ? `이 배치를 로봇으로 재검사: ${row.robotAudit.length}개 경로·가반 미달` : `로봇 근사 검사 미달 ${row.robotAudit.length}개`} · 다른 구역 인출 차단 {row.crossZoneBlockers}개</p>
      <p>{row.extraFit ? `남은 ${row.extraFit}개 품목에서 추가 위치 발견 · 버퍼/탐색 개선 여지` : row.status === 'finished' ? '넓힌 마지막 후보 검사에서도 추가 위치 미발견' : '미완료 실행 · 잔여 공간 검사 미실시'}</p>
      <details><summary>미적재·후보 탈락 근거</summary><p>미적재 ID: {row.unplaced.join(', ') || '없음'}</p><p>미처리 ID: {row.unprocessed.join(', ') || '없음'}</p>
        <p>후보당 원인 집계: {Object.entries(row.rejections).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}</p>
        {row.robotAudit.slice(0, 8).map(a => <p key={a.box}>{a.box}: {a.reasons.join(' / ')}</p>)}
      </details>
    </div>}
  </section>;
}
export default function CapacityLab() {
  const [draft, setDraft] = useState(defaultCapacityConfig), [config, setConfig] = useState(defaultCapacityConfig), [rows, setRows] = useState<CapacityTrial[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('팀의 6개 품목으로 높이 제한과 로봇 제약을 비교합니다.'), [progress, setProgress] = useState(0);
  const [height, setHeight] = useState(1200), [algorithm, setAlgorithm] = useState(''), [seed, setSeed] = useState(1042), [cursor, setCursor] = useState(72), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(2), [camera, setCamera] = useState('cell');
  const [source, setSource] = useState('아직 실행하지 않음');
  const worker = useRef<Worker | null>(null), watchdog = useRef<ReturnType<typeof setTimeout> | null>(null), interacted = useRef(false);
  const stop = () => { worker.current?.terminate(); worker.current = null; if (watchdog.current) clearTimeout(watchdog.current); setBusy(false); };
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}capacity-example.json`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(data => {
      if (!data || interacted.current || data.schema !== CAPACITY_VERSION) return;
      setConfig(data.config); setDraft(data.config); setRows(data.rows); setHeight(data.replayHeight); setSeed(data.replaySeed);
      setCursor(data.config.scenario.types.reduce((n: number, t: { quantity: number }) => n + t.quantity, 0));
      setSource(`저장 계산 · ${data.environment} · ${new Date(data.createdAt).toLocaleString('ko-KR')}`); setMessage('저장된 비교 결과입니다. 조건을 바꾸고 다시 계산할 수 있습니다.');
    }).catch(() => {});
    return () => { controller.abort(); worker.current?.terminate(); if (watchdog.current) clearTimeout(watchdog.current); };
  }, []);
  const total = config.scenario.types.reduce((n, t) => n + t.quantity, 0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, previous = performance.now();
    const frame = (now: number) => { const dt = Math.min(.1, (now - previous) / 1000); previous = now; setCursor(n => { if (n + dt * speed >= total) { setPlaying(false); return total; } return n + dt * speed; }); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);
  const selected = selectedAlgorithm(rows, config, height), shown = algorithm || selected || config.algorithms[0];
  const summary = summarizeCapacity(rows, config, height, 'robot', 'discovery');
  const holdout = summarizeCapacity(rows, config, height, 'robot', 'holdout');
  const selectedHoldout = holdout.find(r => r.algorithm === selected);
  const current = modes.map(mode => rows.find(r => r.algorithm === shown && r.height === height && r.seed === seed && r.mode === mode));
  const deltaRobot = selected ? pairedEffect(rows, selected, height, 'space', config.holdoutSeeds) : null;
  const deltaGroup = selected ? pairedEffect(rows, selected, height, 'organized', config.holdoutSeeds) : null;
  const edit = (f: (c: CapacityConfig) => CapacityConfig) => { interacted.current = true; setDraft(f); };
  const run = () => {
    interacted.current = true;
    let planned; try { planned = trialSpecs(draft); } catch (e) { setMessage((e as Error).message); return; }
    stop(); setConfig(structuredClone(draft)); setRows([]); setProgress(0); setAlgorithm(''); setHeight(draft.heights[0]); setSeed(draft.holdoutSeeds[0]); setCursor(0); setPlaying(false); setBusy(true); setSource('현재 브라우저에서 계산');
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    const armWatchdog = () => { if (watchdog.current) clearTimeout(watchdog.current); watchdog.current = setTimeout(() => { if (worker.current === w) { stop(); setMessage('계산 응답 기한 초과 · 완료된 기록 보존 · 미완료 후보는 선택 제외'); } }, draft.trialMs + 5000); };
    armWatchdog();
    w.onmessage = e => {
      if (worker.current !== w) return;
      if (e.data.type === 'warmup') { setMessage(`${name(e.data.algorithm)} 준비 계산 · 측정에서 제외`); armWatchdog(); }
      if (e.data.type === 'start') { const s = e.data.spec; setMessage(`${e.data.index + 1}/${planned.length} · ${s.height} mm · ${name(s.algorithm)} · ${MODES[s.mode as Mode]} · 시드 ${s.seed}`); armWatchdog(); }
      if (e.data.type === 'row') { setRows(r => [...r, e.data.row]); setProgress(e.data.done / e.data.total); }
      if (e.data.type === 'done') { stop(); setCursor(draft.scenario.types.reduce((n, t) => n + t.quantity, 0)); setMessage('계산 완료 · 선택용 시드에서 기한을 지킨 후보를 고르고 새 시드에서 검증했습니다.'); }
      if (e.data.type === 'error') { stop(); setMessage(e.data.message); }
    };
    w.onerror = e => { stop(); setMessage(`계산 오류: ${e.message}`); }; w.postMessage(structuredClone(draft));
  };
  return <div className="capacity-lab">
    <header className="capacity-intro"><div><h1>한 팔레트에, 기한 안에 얼마나 담을까</h1><p>로봇팔 1대의 적재 능력을 먼저 검증하고, 같은 기반 위에서 매장 구역을 고려합니다.</p></div><a href="?palletView=alps#pallet">ALPS 확장 검증 보기</a></header>
    <section className="capacity-controls" aria-label="비교 조건">
      <div className="capacity-fields">
        <label>최고 높이 mm<input aria-label="최고 높이 mm" type="number" min="200" max="2400" step="100" value={draft.heights[0]} disabled={busy} onChange={e => edit(c => ({ ...c, heights: [Number(e.target.value)] }))}/></label>
        <label>품목당 박스 수<input aria-label="품목당 박스 수" type="number" min="1" max="40" value={draft.scenario.types[0].quantity} disabled={busy} onChange={e => edit(c => ({ ...c, scenario: { ...c.scenario, types: retailScenario(Number(e.target.value)).types } }))}/></label>
        <label>계산 기한 ms<select aria-label="계산 기한 ms" value={draft.decisionMs} disabled={busy} onChange={e => edit(c => ({ ...c, decisionMs: Number(e.target.value) }))}>{[50, 100, 250, 500, 1000].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>후보 수<select value={draft.settings.maxCandidates} disabled={busy} onChange={e => edit(c => ({ ...c, settings: { ...c.settings, maxCandidates: +e.target.value } }))}>{[24, 48, 96, 192].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>임시 보류 용량<select value={draft.bufferCapacity} disabled={busy} onChange={e => edit(c => ({ ...c, bufferCapacity: +e.target.value }))}>{[0, 2, 4, 8].map(n => <option key={n} value={n}>{n}개</option>)}</select></label>
        <button className="capacity-run" disabled={busy} onClick={run}>같은 조건으로 비교</button>
        <button disabled={!busy} onClick={() => { stop(); setMessage('중단됨 · 완료 기록 보존 · 부족한 반복은 순위에서 제외'); }}>계산 중단</button>
      </div>
      <details><summary>높이별 반복 · 로봇 · 알고리즘 설정</summary><div className="capacity-advanced">
        <button disabled={busy} onClick={() => edit(c => ({ ...c, heights: [800, 1200, 1600] }))}>800 / 1200 / 1600 mm 비교</button>
        <span>설정한 높이: {draft.heights.join(' / ')} mm</span>
        <label>시드 반복<select disabled={busy} value={draft.discoverySeeds.length} onChange={e => edit(c => ({ ...c, discoverySeeds: Array.from({ length: +e.target.value }, (_, i) => 42 + i), holdoutSeeds: Array.from({ length: +e.target.value }, (_, i) => 1042 + i) }))}>{[1, 2, 3, 5].map(n => <option key={n} value={n}>선택 {n} + 검증 {n}</option>)}</select></label>
        <label>작업공간 높이 mm<input type="number" min="1000" max="5000" value={draft.scenario.constraints.workspace.zMax} disabled={busy} onChange={e => edit(c => ({ ...c, scenario: { ...c.scenario, constraints: { ...c.scenario.constraints, workspace: { ...c.scenario.constraints.workspace, zMax: +e.target.value } } } }))}/></label>
        <label>TCP 수평 도달 mm<input type="number" min="500" max="5000" value={draft.scenario.constraints.reach!.maxRadius} disabled={busy} onChange={e => edit(c => ({ ...c, scenario: { ...c.scenario, constraints: { ...c.scenario.constraints, reach: { ...c.scenario.constraints.reach!, maxRadius: +e.target.value } } } }))}/></label>
        <label>그리퍼 폭 mm<input type="number" min="50" max="700" value={draft.scenario.constraints.gripper.width} disabled={busy} onChange={e => edit(c => ({ ...c, scenario: { ...c.scenario, constraints: { ...c.scenario.constraints, gripper: { ...c.scenario.constraints.gripper, width: +e.target.value } } } }))}/></label>
      </div><div className="capacity-algorithms">{Object.entries(ALGORITHMS).map(([id, label]) => <label key={id}><input type="checkbox" disabled={busy} checked={draft.algorithms.includes(id)} onChange={e => edit(c => ({ ...c, algorithms: e.target.checked ? [...c.algorithms, id] : c.algorithms.filter(a => a !== id) }))}/>{label}</label>)}</div>
        <p>선택 시드 {draft.discoverySeeds.join(', ')} / 검증 시드 {draft.holdoutSeeds.join(', ')}. 실제 미래 순서는 계획기에 전달하지 않습니다.</p>
      </details>
      <div className="capacity-status" role="status"><span>{message}</span>{busy && <progress value={progress} max="1"/>}</div>
    </section>
    <section className="capacity-verdict" aria-label="기반 알고리즘 선택">
      <div><span>계산 기한 {config.decisionMs} ms 안에서 선택한 기반</span><strong>{selected ? name(selected) : '완료된 선택용 비교가 필요합니다'}</strong></div>
      <p>{selectedHoldout?.eligible ? `새 시드 ${selectedHoldout.n}회 적재율 ${pct(selectedHoldout.utilization.mean)} · 평균 ${num(selectedHoldout.ms.mean)} ms · P95 평균 ${num(selectedHoldout.p95.mean)} ms` : '검증용 시드가 모두 끝나고 계산 기한을 지켜야 검증 완료로 표시합니다.'}<br/>{deltaRobot?.n ? `로봇 제약 적용 시 ${num(-deltaRobot.mean!)}%p` : '로봇 제약 효과 대기'}{deltaGroup?.n ? ` · 구역 고려 추가 시 ${num(deltaGroup.mean)}%p` : ''} {deltaRobot?.n ? `(같은 알고리즘·검증 시드 ${deltaRobot.n}쌍)` : ''}</p>
      <small>선택 기준: 기한 준수 → 평균 부피 적재율 → 적재 개수 → 평균 계산시간. 관측 후보 중 선택이며 최대 적재 증명은 아닙니다.</small>
    </section>
    <div className="capacity-replay-tools"><label>결과 높이<select value={height} onChange={e => { setHeight(+e.target.value); setAlgorithm(''); }}>{config.heights.map(h => <option key={h} value={h}>{h} mm</option>)}</select></label>
      <label>재생 알고리즘<select value={shown} onChange={e => setAlgorithm(e.target.value)}>{config.algorithms.map(a => <option key={a} value={a}>{name(a)}{a === selected ? ' · 선택' : ''}</option>)}</select></label>
      <label>입고 순서<select value={seed} onChange={e => setSeed(+e.target.value)}>{[...config.discoverySeeds, ...config.holdoutSeeds].map(s => <option key={s} value={s}>{s} · {config.discoverySeeds.includes(s) ? '선택용' : '검증용'}</option>)}</select></label>
      <label>시점<select value={camera} onChange={e => setCamera(e.target.value)}><option value="cell">작업셀 전체</option><option value="iso">적재 확대</option><option value="top">위에서</option><option value="front">정면</option></select></label>
      <button disabled={!rows.length} onClick={() => save({ schema: CAPACITY_VERSION, createdAt: new Date().toISOString(), source, config, rows })}>계산 JSON 저장</button>
    </div>
    <div className="capacity-scenes">{modes.map((mode, i) => <Replay key={mode} mode={mode} row={current[i]} config={config} cursor={cursor} camera={camera}/>)}</div>
    <div className="capacity-transport"><button disabled={!current.some(r => r?.trace.length)} onClick={() => { if (cursor >= total) setCursor(0); setPlaying(p => !p); }}>{playing ? '일시정지' : '적재 재생'}</button><button onClick={() => { setPlaying(false); setCursor(0); }}>처음</button>
      <input aria-label="입고 단계" type="range" min="0" max={total} step=".01" value={cursor} onChange={e => { setPlaying(false); setCursor(+e.target.value); }}/><span>입고 {Math.min(total, Math.floor(cursor))} / {total}</span><button onClick={() => { setPlaying(false); setCursor(total); }}>완료 배치</button>
      <select aria-label="재생 속도" value={speed} onChange={e => setSpeed(+e.target.value)}>{[.5, 1, 2, 4, 8].map(n => <option key={n} value={n}>{n}단계/s</option>)}</select>
    </div>
    <div className="capacity-legend">{ZONES.map((zone, i) => <span key={zone}><i style={{ background: COLORS[i] }}/>{zone}</span>)}<span>입고 단계 동기 재생 · 애니메이션 속도와 계산·작업시간은 별도</span></div>
    <section className="capacity-results"><header><h2>높이 {height} mm에서의 적재율과 계산 속도</h2><span>{source}</span></header><div className="capacity-table"><table><thead><tr><th>알고리즘</th><th>선택용 적재율</th><th>평균 / P95 ms</th><th>기한 초과</th><th>검증용 적재율</th><th>검증용 평균 ms</th><th>완료 / 필요</th></tr></thead><tbody>{summary.map(r => { const h = holdout.find(h => h.algorithm === r.algorithm)!; return <tr key={r.algorithm} data-selected={r.algorithm === selected}><th><button onClick={() => setAlgorithm(r.algorithm)}>{name(r.algorithm)}{r.algorithm === selected ? ' ✓' : ''}</button></th><td>{pct(r.utilization.mean)}</td><td>{num(r.ms.mean)} / {num(r.p95.mean)}</td><td>{r.misses + h.misses}회</td><td>{pct(h.utilization.mean)}</td><td>{num(h.ms.mean)}</td><td>{r.n}/{r.expected} · {h.n}/{h.expected}{!r.eligible ? ' · 선택 제외' : !h.eligible ? ' · 검증 미완료' : ''}</td></tr>; })}</tbody></table></div>
      <p>P95는 각 실행의 배치 판단 95백분위 계산시간을 평균한 값입니다. 늦게 끝난 배치는 채택하지 않으며 해당 실행은 선택에서 제외됩니다. 부분 완료 평균만으로 우승을 정하지 않습니다.</p>
    </section>
    {config.heights.length > 1 && <section className="capacity-heights"><h2>최고 높이를 바꾸면</h2>{config.heights.map(h => { const a = selectedAlgorithm(rows, config, h), r = summarizeCapacity(rows, config, h, 'robot', 'holdout').find(r => r.algorithm === a); return <button key={h} onClick={() => { setHeight(h); setAlgorithm(''); }}><b>{h} mm</b><span>{a ? name(a) : '선택 대기'}</span><i><em style={{ width: `${100 * (r?.utilization.mean ?? 0)}%` }}/></i><strong>{pct(r?.utilization.mean)}</strong><small>{r?.eligible ? '검증 완료' : '검증 미완료'}</small></button>; })}</section>}
    <details className="capacity-scope"><summary>입력 근거 · 지표 · 검증 범위</summary><p>팀 문서의 생수·과자·세제·생활용품·헤어케어·스킨케어 규격을 재사용했습니다. 강도·마찰·로봇 시간은 가정입니다. 팔레트 {config.scenario.pallet.width}×{config.scenario.pallet.depth} mm 1개, 입고 {total}개, 보류 {config.bufferCapacity}개. 보류 공간이 가득 차면 미적재로 보존하고 이후 입고를 계속합니다. 팔레트 교체는 없습니다.</p>
      <p>적재율 = 담은 부피 ÷ (팔레트 면적 × 허용 높이). 내부 채움 = 담은 부피 ÷ (팔레트 면적 × 실제 높이). 공급 부피만으로 구한 느슨한 상한: {pct(current[0]?.supplyBound)}. 이 상한과의 차이가 알고리즘만의 손실이라는 뜻은 아닙니다.</p>
      <p>로봇 적용 조건은 도구 포함 유효 가반 38 kg(도구 8 kg), 수평 TCP 도달 반경, 작업공간, 그리퍼·운반 박스 경로를 근사 검사합니다. 표시하는 팔 관절은 설명용이며 제조사 IK·전체 링크 충돌·실제 흡착·동적 물리는 미검증입니다. 보류 이동 시간은 경로 시간에 포함되지 않습니다. 계산 기한은 재검사를 포함한 배치 판단 1회에 적용하며, 입고 한 건의 전체 처리 지연과 구분합니다.</p>
      <p>매장 구역은 기존 알고리즘 후보에 선호를 추가합니다. 원래 선택보다 높이를 최대 {config.groupHeightSlack} mm 더 쓰는 후보까지 비교합니다. 다른 구역 인출 차단은 기하 지표이며 매장 작업시간으로 환산하지 않았습니다. 래핑·이송·직원 진열은 이 비교 범위 밖입니다.</p>
      <p>기존 팀 기록의 종합점수 순위를 가져오지 않고 새 조건에서 재계산합니다. 최고 높이 부피율과 시간 기한을 함께 평가하며, 후보 예산 내 탐색 결과를 제공합니다.</p>
    </details>
  </div>;
}
