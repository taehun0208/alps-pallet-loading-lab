import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
async function run(page:any){const d=page.waitForEvent('download');await page.getByRole('button',{name:'실행 JSON 저장',exact:true}).click();return JSON.parse(readFileSync((await (await d).path())!,'utf8'));}

test('high-stack button preserves the previous run and automatically builds six supported tiers with active constraints',async({page})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#pallet');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');
 await expect(page.getByRole('button',{name:'한 단계',exact:true})).toBeEnabled({timeout:20000});await page.getByRole('button',{name:'한 단계',exact:true}).click();await expect(page.locator('.pallet-metrics').first()).toContainText('1개');const previous=await run(page);
 await page.getByRole('combobox',{name:'입고 시나리오'}).selectOption('high-stack');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('16');await page.getByRole('button',{name:'▶ 자동 적재',exact:true}).click();await expect(page.getByRole('combobox',{name:'입고 시나리오'})).toHaveValue('high-stack');
 await expect(page.getByRole('combobox',{name:'재생 속도'})).toHaveValue('16');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');
 await expect(page.locator('.pallet-status')).toContainText('입고 처리 완료',{timeout:120000});
 const result=await run(page);expect(result.frame.placements).toHaveLength(24);expect(result.metrics.height).toBe(1472);expect(result.metrics.complete).toBe(true);expect(result.scenario.constraints).toEqual(previous.scenario.constraints);expect(result.patternEvaluation.valid).toBe(true);
 await expect(page.getByLabel('적재 높이 분석')).toHaveAttribute('data-layers','6');await expect(page.getByLabel('적재 높이 분석')).toContainText('1,472 / 1,600 mm');
 await expect(page.getByRole('combobox',{name:'보관 실행'}).locator(`option[value="${previous.runId}"]`)).toHaveCount(1);
 for(const record of result.frame.records){expect(record.placement.supportRatio).toBeGreaterThanOrEqual(.95-1e-6);expect(record.path.model).toBe('gripper');}
 const snapshot=result.frame.placements.map((b:any)=>b.position);
 await page.getByRole('slider',{name:'배치 이력'}).fill('8');await expect(page.getByLabel('적재 높이 분석')).toHaveAttribute('data-layers','2');await page.getByRole('button',{name:'현재로 돌아가기'}).click();await expect(page.getByLabel('적재 높이 분석')).toHaveAttribute('data-layers','6');
 await page.getByRole('button',{name:'물리 검증 실행',exact:true}).click();await expect(page.locator('.pallet-physics-result')).toHaveText('설정한 조건에서 안정',{timeout:20000});
 const verified=await run(page);expect(verified.physics?.poses).toHaveLength(24);expect(verified.physics?.status).toBe('stable');expect(verified.frame.placements.map((b:any)=>b.position)).toEqual(snapshot);
 writeFileSync('docs/pallet-height-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),scenario:verified.scenario,metrics:verified.metrics,patternEvaluation:verified.patternEvaluation,physics:verified.physics,positionsUnchanged:true},null,2));
 // Hide only candidate overlays for a clear view; this cannot modify the placement result.
 await page.getByLabel('후보',{exact:true}).uncheck();
 for(const width of [1366,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`docs/pallet-height-${width}.png`,fullPage:true});}
 await page.setViewportSize({width:1366,height:900});await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-height-scene.png'});
 expect(errors).toEqual([]);
});

test('the same random inventory stacks higher when physically selectable, keeping box data and all constraints',async({page})=>{
 test.setTimeout(180000);await page.goto('/#pallet');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');await page.getByRole('button',{name:'▶ 자동 적재',exact:true}).click();await expect(page.locator('.pallet-status')).toContainText('배치 중단',{timeout:45000});
 const before=await run(page);expect(before.metrics.height).toBe(630);expect(before.metrics.count).toBe(8);
 await expect(page.getByLabel('적재 높이 분석')).toContainText('높이 여유 970 mm');await expect(page.getByLabel('적재 높이 분석')).toContainText('B28-01');await expect(page.getByLabel('적재 높이 분석')).toContainText('필요한 지지율 95.0%');
 await page.getByRole('button',{name:'현재 재고 모아서 실행',exact:true}).click();await expect(page.getByRole('combobox',{name:'박스 공급 방식'})).toHaveValue('stock-select');await expect(page.getByRole('combobox',{name:'재생 속도'})).toHaveValue('16');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');
 await expect(page.locator('.pallet-status')).toContainText('남은 재고 배치 불가',{timeout:120000});
 const after=await run(page);expect(after.scenario.types).toEqual(before.scenario.types);expect(after.scenario.pallet).toEqual(before.scenario.pallet);expect(after.scenario.constraints).toEqual(before.scenario.constraints);expect(after.settings.stockPolicy).toBe('compact');expect(after.metrics.count).toBeGreaterThan(before.metrics.count);expect(after.metrics.volume).toBeGreaterThan(before.metrics.volume);
 await page.getByRole('combobox',{name:'보관 실행'}).selectOption(before.runId);await expect(page.getByLabel('적재 높이 분석')).toContainText('630 / 1,600 mm');expect((await run(page)).frame.placements).toEqual(before.frame.placements);
});

test('a shareable high-stack URL starts the demo once and pause and preset changes stop that request',async({page})=>{
 test.setTimeout(60000);await page.goto('/?palletDemo=legacy-high-stack#pallet');await expect(page.getByRole('combobox',{name:'입고 시나리오'})).toHaveValue('high-stack');await expect(page.getByRole('button',{name:'Ⅱ 일시정지',exact:true})).toBeEnabled({timeout:15000});
 await page.getByRole('button',{name:'Ⅱ 일시정지',exact:true}).click();const first=await run(page);await page.waitForTimeout(300);expect((await run(page)).frame.processed).toBe(first.frame.processed);
 await page.getByRole('combobox',{name:'입고 시나리오'}).selectOption('online-task');await expect(page.getByRole('button',{name:'한 단계',exact:true})).toBeEnabled({timeout:20000});await expect(page.getByRole('button',{name:'Ⅱ 일시정지',exact:true})).toBeDisabled();expect((await run(page)).frame.processed).toBe(0);
});
