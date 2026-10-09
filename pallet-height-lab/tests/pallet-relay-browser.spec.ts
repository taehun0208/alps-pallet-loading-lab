import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
async function exported(page:any){const d=page.waitForEvent('download');await page.getByRole('button',{name:'4대 실행 JSON 저장',exact:true}).click();return JSON.parse(readFileSync((await (await d).path())!,'utf8'));}
test('moves four arms at once, lets completed arms restart independently, and receives straight onto the pallet',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?palletDemo=relay#pallet');
 const canvas=page.getByTestId('relay-scene').locator('canvas');await expect(canvas).toHaveAttribute('data-robots','4');await expect(page.getByRole('button',{name:'준비된 팔 함께 시작',exact:true})).toBeEnabled();
 const initial=await exported(page);await page.getByRole('combobox',{name:'협업 재생 속도'}).selectOption('1');await page.getByRole('button',{name:'준비된 팔 함께 시작',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-active-count','4');const first=JSON.parse((await canvas.getAttribute('data-robot-state'))!);expect(first.every((r:any)=>r.active)).toBe(true);
 await expect.poll(async()=>{const now=JSON.parse((await canvas.getAttribute('data-robot-state'))!);return now.filter((r:any,i:number)=>JSON.stringify(r.tcp)!==JSON.stringify(first[i].tcp)).length;}).toBe(4);
 await page.getByRole('button',{name:'협업 일시정지',exact:true}).click();await expect(page.getByLabel('협업 실행 상태')).toContainText('일시정지');expect((await exported(page)).world).toEqual(initial.world);
 await page.getByTestId('relay-scene').screenshot({path:'docs/pallet-concurrent-moving.png'});
 await page.getByRole('button',{name:'협업 동작 취소',exact:true}).click();expect((await exported(page)).world).toEqual(initial.world);await expect(canvas).toHaveAttribute('data-active-count','0');
 await page.getByRole('combobox',{name:'협업 재생 속도'}).selectOption('4');await page.getByRole('button',{name:'▶ 4대 자동 실행',exact:true}).click();await expect(page.getByLabel('협업 실행 상태')).toContainText('전체 재고 적재 완료',{timeout:60000});
 const done=await exported(page);expect(done.peakConcurrent).toBe(4);expect(done.summary).toMatchObject({initial:8,placed:8,waiting:0,transfers:2,staged:0});expect(done.world.records.filter((r:any)=>r.kind==='receive-place')).toHaveLength(2);
 const records=done.world.records;expect(records.some((r:any)=>records.some((q:any)=>q.robot!==r.robot&&q.started<r.started&&q.finished>r.started))).toBe(true);
 expect(done.world.cells[1].placements.map((p:any)=>p.id)).toContain('A1-01');expect(done.world.cells[3].placements.map((p:any)=>p.id)).toContain('A3-01');
 await page.getByRole('slider',{name:'협업 동작 이력'}).fill('0');expect((await exported(page)).world).toEqual(initial.world);await page.getByRole('button',{name:'협업 현재로 돌아가기'}).click();expect((await exported(page)).world).toEqual(done.world);
 await page.screenshot({path:'docs/pallet-concurrent-dashboard.png',fullPage:true});
 for(const width of [1440,390]){await page.setViewportSize({width,hfour:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 writeFileSync('docs/pallet-concurrent-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),summary:done.summary,peakConcurrent:done.peakConcurrent,world:done.world,errors},null,2));expect(errors).toEqual([]);
});
test('receiver chooses its own queue and later packs held boxes after foundations',async({page})=>{
 test.setTimeout(100000);await page.goto('/?palletDemo=relay#pallet');await page.getByRole('button',{name:'회수 후 보관 예제',exact:true}).click();await page.getByRole('combobox',{name:'협업 재생 속도'}).selectOption('64');await expect(page.getByRole('button',{name:'준비된 팔 함께 시작',exact:true})).toBeEnabled();await page.getByRole('button',{name:'준비된 팔 함께 시작',exact:true}).click();
 const canvas=page.getByTestId('relay-scene').locator('canvas');await expect(canvas).toHaveAttribute('data-active-count','0',{timeout:15000});const onPads=await exported(page);expect(onPads.summary.staged).toBe(4);
 await page.getByRole('combobox',{name:'협업 재생 속도'}).selectOption('1');await expect(page.getByRole('button',{name:'준비된 팔 함께 시작',exact:true})).toBeEnabled();await page.getByRole('button',{name:'준비된 팔 함께 시작',exact:true}).click();await expect(canvas).toHaveAttribute('data-active-count','4');await page.getByRole('button',{name:'협업 동작 취소',exact:true}).click();expect((await exported(page)).world).toEqual(onPads.world);
 await page.getByRole('combobox',{name:'협업 재생 속도'}).selectOption('64');await page.getByRole('button',{name:'▶ 4대 자동 실행',exact:true}).click();await expect(page.getByLabel('협업 실행 상태')).toContainText('전체 재고 적재 완료',{timeout:65000});
 const done=await exported(page);expect(done.summary).toMatchObject({placed:8,waiting:0,staged:0,transfers:4});expect(done.world.records.filter((r:any)=>r.kind==='receive-queue').length).toBeGreaterThan(0);expect(done.world.records.filter((r:any)=>r.kind==='send')).toHaveLength(4);
 const stagedIndex=done.history.findIndex((w:any)=>w.pads.some((p:any)=>p.boxId));expect(stagedIndex).toBeGreaterThan(0);await page.getByRole('slider',{name:'협업 동작 이력'}).fill(String(stagedIndex));const staged=await exported(page);expect(staged.summary.staged).toBeGreaterThan(0);expect(staged.summary.placed+staged.summary.waiting).toBe(8);
 await page.getByRole('button',{name:'협업 현재로 돌아가기'}).click();await page.screenshot({path:'docs/pallet-concurrent-storage.png',fullPage:true});
});

test('uses the current mixed stock once across four cells, preserving the independent single-arm mode',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?palletDemo=compact#pallet');await page.getByRole('button',{name:'4대 로봇 협업',exact:true}).click();await page.getByRole('button',{name:'현재 박스 세트 사용',exact:true}).click();
 await expect(page).toHaveURL(/palletView=relay/);let r=await exported(page);expect(r.summary.initial).toBe(30);expect(r.world.cells.map((c:any)=>c.queue.length)).toEqual([8,8,7,7]);
 await page.getByRole('combobox',{name:'협업 재생 속도'}).selectOption('64');await page.getByRole('button',{name:'▶ 4대 자동 실행',exact:true}).click();await expect.poll(async()=>{const text=await page.getByLabel('협업 실행 상태').innerText();return text.includes('전체 재고 적재 완료')||text.includes('가능한 적재/전달 없음');},{timeout:85000}).toBe(true);
 r=await exported(page);expect(r.summary.placed+r.summary.waiting).toBe(30);expect(r.world.cells.every((c:any)=>c.placements.length>0)).toBe(true);expect(r.world.boxes.every((b:any)=>b.visited.every((v:number,i:number)=>i===0||v===(b.visited[i-1]+1)%4))).toBe(true);
 await page.getByTestId('relay-scene').screenshot({path:'docs/pallet-concurrent-mixed.png'});await page.getByRole('button',{name:'적재 실험',exact:true}).click();await expect(page.getByTestId('pallet-scene')).toBeVisible();await page.getByRole('button',{name:'4대 로봇 협업',exact:true}).click();expect((await exported(page)).world).toEqual(r.world);
 await page.getByRole('checkbox',{name:'인접 로봇 전달 사용',exact:true}).uncheck();const reset=await exported(page);expect(reset.transfers).toBe(false);expect(reset.world.revision).toBe(0);expect(reset.summary.initial).toBe(30);expect(errors).toEqual([]);
});

test('the mixed four-cell link opens four arms directly without starting the single-pallet run',async({page})=>{
 await page.goto('/?palletDemo=compact&palletView=relay#pallet');await expect(page.getByTestId('relay-scene').locator('canvas')).toHaveAttribute('data-robots','4');
 expect((await exported(page)).summary).toMatchObject({initial:192,placed:0,waiting:192,palletCount:4});
 await page.getByRole('button',{name:'적재 실험',exact:true}).click();await expect(page.locator('.pallet-status')).toContainText('단계 0 / 30');
});
