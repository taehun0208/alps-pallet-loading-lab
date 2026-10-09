import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const choosePlayerScenario=async(page:import('@playwright/test').Page,title:RegExp)=>{
  await page.getByRole('button',{name:'선수 전략',exact:true}).click();
  await page.getByRole('button',{name:title}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
};
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.getByTestId('score-total')).toBeVisible();await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();});
test('initial pause, player stages, undo and no double commit',async({page})=>{
  await expect(page.getByRole('heading',{name:'구멍 하나가 선택을 바꾸는 이유'})).toBeVisible();
  await expect(page.locator('.timeline button.active')).toContainText('관찰');
  await page.getByRole('button',{name:'재생 Space'}).click();
  await expect(page.getByRole('button',{name:'일시정지 Space'})).toBeVisible();
  await page.getByRole('button',{name:'일시정지 Space'}).click();
  await page.getByRole('button',{name:'다음 설명 단계',exact:true}).click();
  await expect(page.locator('.timeline button.active')).toContainText('후보 생성');
  await page.getByRole('button',{name:'4 지표 계산',exact:true}).click();
  await expect(page.locator('.hole-outline').first()).toBeVisible();
  await expect(page.locator('.lesson-copy')).toContainText('구멍');
  mkdirSync('screenshots',{recursive:true});
  await page.screenshot({path:'screenshots/lab-desktop.png'});
  await page.getByRole('button',{name:'8 실제 적용',exact:true}).click();
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 1블록');
  await page.getByRole('button',{name:'이번 결정 처음으로',exact:true}).click();
  await page.getByRole('button',{name:'8 실제 적용',exact:true}).click();
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 1블록');
  await page.getByRole('button',{name:'전체 초기화',exact:true}).click();
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 0블록');
});
test('weight changes are real and the latest rapid edit wins',async({page})=>{
  const before=await page.locator('.candidate-card.chosen .candidate-content strong').innerText();
  await page.getByRole('spinbutton',{name:'구멍 패널티 숫자',exact:true}).fill('0');
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).not.toHaveText(before);
  await page.getByRole('spinbutton',{name:'구멍 패널티 숫자',exact:true}).fill('20');
  await page.getByRole('spinbutton',{name:'구멍 패널티 숫자',exact:true}).fill('0');
  await page.getByRole('spinbutton',{name:'구멍 패널티 숫자',exact:true}).fill('8');
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).toHaveText(before);
  const data=await page.locator('.score-table tbody tr td:last-child').allTextContents();
  const displayed=+(await page.getByTestId('score-total').innerText()).replace('점','');
  expect(data.reduce((n,t)=>n+parseFloat(t),0)).toBeCloseTo(displayed,4);
});
test('future scenario differs from greedy and beam nodes have actual counts',async({page})=>{
  await page.getByRole('button',{name:/05 다음 블록의 가능성/}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  const future=await page.locator('.candidate-card.chosen .candidate-content strong').innerText();
  await page.getByRole('combobox',{name:'탐색 알고리즘',exact:true}).selectOption('greedy');
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).not.toHaveText(future);
  await page.getByRole('button',{name:/06 남길 가지, 버릴 가지/}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await page.locator('.explorer summary').click();
  await expect(page.locator('.tree-depth')).toHaveCount(3);
  await expect(page.locator('.tree-node.cut').first()).toBeVisible();
  const count=await page.locator('.explorer summary').innerText();
  await page.getByRole('combobox',{name:'빔 너비',exact:true}).selectOption('1');
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.explorer summary')).not.toHaveText(count);
  await page.locator('.tree-node').first().click();
  await expect(page.locator('.board-instruction')).toContainText('노드');
});
test('candidate pinning, actual branch, edit gating and JSON transfer',async({page})=>{
  await page.locator('.pin-button').nth(0).click();await page.locator('.pin-button').nth(1).click();
  await expect(page.locator('.pinned-grid>div')).toHaveCount(2);
  await page.getByRole('button',{name:'이 수로 새 분기'}).first().click();
  await expect(page.locator('.branch-badge')).toContainText('새 실험 분기');
  await page.getByRole('button',{name:'자유 실험',exact:true}).click();
  await page.getByRole('checkbox',{name:'보드 편집',exact:true}).check();
  await expect(page.locator('.board-svg.editable')).toBeVisible();
  await page.getByRole('spinbutton',{name:'편집 셀 x'}).fill('0');await page.getByRole('spinbutton',{name:'편집 셀 y'}).fill('0');
  await page.getByRole('button',{name:'셀 채우기 / 지우기',exact:true}).click();
  await expect(page.locator('.main-board .piece-8').first()).toBeVisible();
  const beforePaint=await page.locator('.main-board .piece-8').count();
  const svg=page.locator('.main-board>.board-svg'),bounds=await svg.boundingBox();
  const view=await svg.getAttribute('viewBox'),dimensions=view!.split(' ').map(Number);
  const start={x:bounds!.x+32/dimensions[2]*bounds!.width,y:bounds!.y+48/dimensions[3]*bounds!.height};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(bounds!.x+92/dimensions[2]*bounds!.width,start.y,{steps:12});await page.mouse.up();
  await expect(page.locator('.main-board .piece-8')).toHaveCount(beforePaint+4);
  await page.getByRole('checkbox',{name:'보드 편집',exact:true}).uncheck();
  await expect(page.locator('.board-svg.editable')).toHaveCount(0);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'내보내기',exact:true}).click();const download=await downloadPromise;
  const filePath=await download.path();expect(filePath).toBeTruthy();
  await page.locator('input[type=file]').setInputFiles(filePath!);await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.custom-notice')).toBeVisible();
});
test('comparison uses common supply, synchronises by block count and draws records',async({page})=>{
  await page.getByRole('button',{name:'알고리즘 비교',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'탐색 깊이',exact:true})).toHaveValue('3');
  await expect(page.getByRole('combobox',{name:'빔 너비',exact:true})).toHaveValue('10');
  await page.getByRole('combobox',{name:'비교 블록 상한'}).selectOption('10');
  await page.getByRole('button',{name:'비교 실행',exact:true}).click();
  await expect(page.locator('.compare-status')).toContainText('설정한 상한 도달',{timeout:60000});
  await expect(page.locator('.compare-metrics>div:first-child b')).toHaveText(['10블록','10블록','10블록']);
  await expect(page.locator('.chart-line')).toHaveCount(6);
  await expect(page.getByRole('button',{name:'처음 다른 수를 선택한 순간'})).toBeEnabled();
  await page.getByRole('button',{name:'처음 다른 수를 선택한 순간'}).click();
  await expect(page.locator('.divergence')).toBeVisible();
  await page.getByRole('button',{name:'비교 초기화',exact:true}).click();
  await expect(page.locator('.compare-status')).toContainText('준비');
  await page.getByRole('button',{name:'비교 실행',exact:true}).click();await page.getByRole('button',{name:'중지',exact:true}).click();
  await expect(page.locator('.compare-status')).toContainText('사용자 중지');
});
test('keyboard and responsive viewports keep board and play usable, no console errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('body').click({position:{x:5,y:150}});await page.keyboard.press('ArrowRight');
  await expect(page.locator('.timeline button.active')).toContainText('후보 생성');
  for(const size of [{width:1366,height:768},{width:1440,height:900},{width:768,height:1024},{width:414,height:896},{width:375,height:812},{width:320,height:740}]){
    await page.setViewportSize(size);await page.evaluate(()=>window.scrollTo(0,0));
    await expect(page.locator('.main-board')).toBeVisible();await expect(page.getByRole('button',{name:'재생 Space'})).toBeVisible();
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,board:document.querySelector('.main-board')!.getBoundingClientRect().toJSON(),player:document.querySelector('.player')!.getBoundingClientRect().toJSON()}));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);expect(layout.board.right).toBeLessThanOrEqual(size.width);expect(layout.board.bottom).toBeLessThanOrEqual(layout.player.top+2);
    await page.screenshot({path:`test-results/layout-${size.width}x${size.height}.png`});
  }
  expect(errors).toEqual([]);
  await page.getByRole('button',{name:'설정',exact:true}).first().click();await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button',{name:'해설',exact:true}).click();await expect(page.locator('.explanation')).toBeVisible();
});
test('animation previews multiple actual landings, then one decision stops',async({page})=>{
  await page.getByRole('button',{name:'3 가상 낙하',exact:true}).click();
  const initial=await page.locator('.board-instruction').innerText();
  await page.getByRole('combobox',{name:'재생 배속'}).selectOption('2');
  await page.getByRole('button',{name:'재생 Space'}).click();
  await expect(page.locator('.board-instruction')).not.toHaveText(initial);
  await expect(page.locator('.timeline button.active')).toContainText('지표 계산');
  await page.getByRole('button',{name:'일시정지 Space'}).click();
  await expect(page.locator('.hole-outline')).toHaveCount(1);
  await expect(page.locator('.hole-callout')).toContainText('−8.0');
  await page.getByRole('combobox',{name:'재생 배속'}).selectOption('4');
  await page.getByRole('button',{name:'재생 Space'}).click();
  await expect(page.locator('.timeline button.active')).toContainText('실제 적용');
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeVisible();
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 1블록');
});
test('fast continuous play can be paused even while next decision is being computed',async({page})=>{
  await page.getByRole('checkbox',{name:'연속 자동 플레이'}).check();
  await page.getByRole('checkbox',{name:'빠른 적용'}).check();
  await page.getByRole('combobox',{name:'재생 배속'}).selectOption('4');
  await page.getByRole('button',{name:'재생 Space'}).click();
  await expect.poll(async()=>+(await page.locator('.lab-footer').innerText()).match(/실제 배치 (\d+)블록/)![1]).toBeGreaterThanOrEqual(2);
  await page.getByRole('button',{name:'일시정지 Space'}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeVisible();
  const count=(await page.locator('.lab-footer').innerText()).match(/실제 배치 (\d+)블록/)![1];
  await page.getByRole('combobox',{name:'재생 배속'}).selectOption('1');
  await page.getByRole('button',{name:'이번 결정 처음으로'}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.lab-footer')).toContainText(`실제 배치 ${count}블록`);
});
test('line clearing overlay uses pre-clear board then displays post-clear measurements',async({page})=>{
  await page.getByRole('button',{name:/04 줄 삭제와 평가/}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await page.getByRole('button',{name:'4 지표 계산',exact:true}).click();
  await expect(page.locator('.clear-row')).toHaveCount(4);
  await expect(page.locator('.clear-row')).toHaveCount(0);
  await expect(page.locator('.main-board .piece')).toHaveCount(0);
  await expect(page.getByTestId('score-total')).toContainText('40.0');
  await expect(page.locator('.lesson-copy')).toContainText('삭제 전 높이 합 40');
});
test('export after actual application saves new board and preserves future consumption index',async({page})=>{
  await page.getByRole('button',{name:'8 실제 적용',exact:true}).click();
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 1블록');
  await page.getByRole('button',{name:'자유 실험',exact:true}).click();
  const promise=page.waitForEvent('download');await page.getByRole('button',{name:'내보내기',exact:true}).click();const download=await promise;
  const file=await download.path(),data=JSON.parse(readFileSync(file!,'utf8'));
  expect(data.supply.index).toBe(1);expect(data.current).toBe('J');expect(data.supply.pieces[1]).toBe(data.current);
  expect(data.board.flat().filter((c:number)=>c===6)).toHaveLength(4);
  await page.locator('input[type=file]').setInputFiles(file!);
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.current-piece')).toContainText('J');
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 1블록');
});

test('player strategy really preserves a well and compares the same state against balanced',async({page})=>{
  await choosePlayerScenario(page,/I를 위한 한 열 남기기/);
  await expect(page.getByRole('combobox',{name:'플레이 전략',exact:true})).toHaveValue('well-right');
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).toHaveText('회전 0 · x 5');
  await expect(page.getByTestId('strategy-difference')).toContainText('1:8 → 0:5');
  await expect(page.locator('.well-overlay.open')).toBeVisible();
  await expect(page.locator('.score-table tbody tr')).toHaveCount(7);
  await page.getByRole('button',{name:'4 지표 계산',exact:true}).click();
  const values=await page.locator('.score-table tbody tr td:last-child').allTextContents();
  const total=parseFloat(await page.getByTestId('score-total').innerText());
  expect(values.reduce((n,t)=>n+parseFloat(t),0)).toBeCloseTo(total,4);
  await page.getByRole('combobox',{name:'플레이 전략',exact:true}).selectOption('balanced');
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).toHaveText('회전 1 · x 8');
  await expect(page.locator('.well-overlay')).toHaveCount(0);
  await expect(page.locator('.score-table tbody tr')).toHaveCount(4);
  for(const [profile,x] of [['well-left','1'],['well-63','121']] as const){
    await page.getByRole('combobox',{name:'플레이 전략',exact:true}).selectOption(profile);
    await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
    await expect(page.locator('.main-board .well-overlay rect')).toHaveAttribute('x',x);
  }
});

test('O builds four ready rows then NEXT I actually clears four with additional reward',async({page})=>{
  await choosePlayerScenario(page,/쌓고, I로 네 줄 회수/);
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).toHaveText('회전 0 · x 0');
  await page.getByRole('button',{name:'6 미래 탐색',exact:true}).click();
  await expect(page.locator('.path-breakdown')).toContainText('누적 R 80.0');
  await expect(page.locator('.path-breakdown')).toContainText('누적 4줄 추가 40.0');
  await page.getByRole('button',{name:'다음 블록까지',exact:true}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.locator('.current-piece')).toContainText('I');
  await expect(page.locator('.strategy-readings dd').nth(2)).toHaveText('4 / 4');
  await expect(page.locator('.candidate-card.chosen .candidate-content strong')).toHaveText('회전 1 · x 9');
  await page.getByRole('button',{name:'7 최종 선택',exact:true}).click();
  const scoreBounds=await page.getByTestId('score-total').boundingBox(),playerBounds=await page.locator('.player').boundingBox();
  expect(scoreBounds!.y+scoreBounds!.height).toBeLessThan(playerBounds!.y);
  mkdirSync('screenshots',{recursive:true});
  await page.screenshot({path:'screenshots/player-strategies.png'});
  await page.getByRole('button',{name:'4 지표 계산',exact:true}).click();
  await expect(page.locator('.clear-row')).toHaveCount(4);
  await expect(page.locator('.clear-row')).toHaveCount(0);
  await expect(page.getByTestId('tetris-contribution')).toContainText('40.0');
  await expect(page.getByTestId('score-total')).toHaveText('80.0점');
  await page.getByRole('button',{name:'8 실제 적용',exact:true}).click();
  await expect(page.locator('.main-board .piece')).toHaveCount(0);
  await expect(page.locator('.lab-footer')).toContainText('삭제 4줄');
  await expect(page.locator('.lab-footer')).toContainText('실제 배치 2블록');
});

test('dangerous well setup takes a real three-line escape',async({page})=>{
  await choosePlayerScenario(page,/기다리기보다 먼저 낮추기/);
  await expect(page.getByTestId('danger-contribution')).toContainText('-192.0');
  await expect(page.locator('.lesson-copy')).toContainText('16칸');
  await page.getByRole('button',{name:'4 지표 계산',exact:true}).click();
  await expect(page.locator('.clear-row')).toHaveCount(3);
  await expect(page.locator('.clear-row')).toHaveCount(0);
  await expect(page.getByTestId('danger-contribution')).toContainText('-12.0');
  await expect(page.locator('.candidate-card.chosen')).toContainText('줄 삭제 3');
  await expect(page.getByTestId('tetris-contribution')).toContainText('0.0');
  await page.getByRole('button',{name:'8 실제 적용',exact:true}).click();
  await expect(page.locator('.lab-footer')).toContainText('삭제 3줄');
});

test('strategy persists through JSON and common-strategy comparison reports real clear counts',async({page})=>{
  await choosePlayerScenario(page,/쌓고, I로 네 줄 회수/);
  await page.getByRole('button',{name:'다음 블록까지',exact:true}).click();
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await page.getByRole('button',{name:'자유 실험',exact:true}).click();
  const promise=page.waitForEvent('download');await page.getByRole('button',{name:'내보내기',exact:true}).click();
  const download=await promise,file=await download.path(),data=JSON.parse(readFileSync(file!,'utf8'));
  expect(data.config.strategy).toBe('well-right');expect(data.supply.index).toBe(1);
  await page.getByRole('combobox',{name:'플레이 전략',exact:true}).selectOption('balanced');
  await page.locator('input[type=file]').setInputFiles(file!);
  await expect(page.getByRole('button',{name:'재생 Space'})).toBeEnabled();
  await expect(page.getByRole('combobox',{name:'플레이 전략',exact:true})).toHaveValue('well-right');
  await page.getByRole('button',{name:'알고리즘 비교',exact:true}).click();
  await expect(page.locator('.compare-toolbar')).toContainText('오른쪽 웰');
  await page.getByRole('combobox',{name:'비교 블록 상한'}).selectOption('10');
  await page.getByRole('button',{name:'비교 실행',exact:true}).click();
  await expect(page.locator('.compare-status')).toContainText('설정한 상한 도달',{timeout:60000});
  await expect(page.locator('.compare-tetrises')).toHaveCount(3);
  await expect(page.locator('.compare-clear-counts')).toHaveCount(3);
  const counts=await page.locator('.compare-clear-counts').allTextContents();
  const lines=await page.locator('.compare-metrics>div:nth-child(2) b').allTextContents();
  for(let i=0;i<3;i++){const hits=[...counts[i].matchAll(/([1-4])줄 (\d+)/g)];expect(hits.reduce((n,m)=>n+Number(m[1])*Number(m[2]),0)).toBe(parseInt(lines[i]));}
  await expect(page.locator('.compare-tetrises b')).not.toHaveText(['0','0','0']);
});

test('player strategy panels work on narrow screens with no runtime errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:375,height:812});
  await page.getByRole('button',{name:'설정',exact:true}).first().click();
  await choosePlayerScenario(page,/I를 위한 한 열 남기기/);
  await page.getByRole('button',{name:'보드',exact:true}).click();
  await expect(page.locator('.main-board .well-overlay')).toBeVisible();
  await expect(page.getByTestId('strategy-difference')).toContainText('1:8 → 0:5');
  await page.getByRole('button',{name:'해설',exact:true}).click();
  await expect(page.getByTestId('well-contribution')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

