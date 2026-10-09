import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
async function exported(page:any){const d=page.waitForEvent('download');await page.getByRole('button',{name:'실행 JSON 저장',exact:true}).click();return JSON.parse(readFileSync((await (await d).path())!,'utf8'));}

test('old high-stack link now opens the individual random compact simulation',async({page})=>{
 await page.goto('/?palletDemo=high-stack#pallet');await expect(page.getByRole('combobox',{name:'입고 시나리오'})).toHaveValue('spatial-mixed');await expect(page.getByRole('combobox',{name:'재고 배치 전략'})).toHaveValue('compact');await expect(page.getByRole('button',{name:'Ⅱ 일시정지',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Ⅱ 일시정지',exact:true}).click();const r=await exported(page);expect(r.scenario.supplyMode).toBe('stock-select');expect(r.scenario.generation.assortment).toBe('individual');
});

test('mixed packing URL runs the real individual random stock and replays actual frames',async({page})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?palletDemo=compact#pallet');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');
 await expect(page.getByRole('region',{name:'혼합 공간 채우기'})).toContainText('내부 빈틈을 채우고, 필요하면 세워서');
 await expect(page.getByRole('combobox',{name:'재고 배치 전략'})).toHaveValue('compact');
 await expect(page.locator('.pallet-status')).toContainText('남은 재고 배치 불가',{timeout:120000});
 const result=await exported(page);expect(result.frame.placements).toHaveLength(16);expect(result.metrics.height).toBe(964);expect(result.scenario.generation.assortment).toBe('individual');expect(result.patternEvaluation.valid).toBe(true);expect(result.frame.placements.some((b:any)=>typeof b.orientation==='string')).toBe(true);
 expect(result.frame.records.filter((r:any)=>r.placement).every((r:any)=>r.analysis.stockSelection.sizePriority==='low-space-fit')).toBe(true);
 await page.getByLabel('후보',{exact:true}).uncheck();await page.setViewportSize({width:1440,height:1000});await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-spatial-planned-scene.png'});await page.getByRole('button',{name:'물리 검증 실행',exact:true}).click();await expect(page.locator('.pallet-physics-result')).toHaveText('설정한 조건에서 안정',{timeout:20000});
 const verified=await exported(page);expect(verified.frame.placements).toEqual(result.frame.placements);
 writeFileSync('docs/pallet-spatial-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),scenario:verified.scenario,metrics:verified.metrics,physics:verified.physics,patternEvaluation:verified.patternEvaluation},null,2));
 await page.getByLabel('후보',{exact:true}).uncheck();await page.setViewportSize({width:1440,height:1000});
 await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-spatial-scene.png'});
 await page.getByRole('slider',{name:'배치 이력'}).fill('8');expect((await exported(page)).frame.placements).toHaveLength(8);await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-spatial-frame-8.png'});
 await page.getByRole('button',{name:'현재로 돌아가기'}).click();expect((await exported(page)).frame.placements).toHaveLength(16);
 for(const width of [1440,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`docs/pallet-spatial-${width}.png`,fullPage:true});}
 expect(errors).toEqual([]);
});

test('new random stock keeps physical constraints and reruns the compact strategy without changing box dimensions afterwards',async({page})=>{
 test.setTimeout(60000);await page.goto('/#pallet');await expect(page.getByRole('button',{name:'한 단계',exact:true})).toBeEnabled({timeout:20000});const before=await exported(page);
 await page.getByRole('button',{name:'랜덤 혼합 재고 실행',exact:true}).click();await expect(page.getByRole('combobox',{name:'재고 배치 전략'})).toHaveValue('compact');await expect(page.getByRole('button',{name:'Ⅱ 일시정지',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Ⅱ 일시정지',exact:true}).click();
 const random=await exported(page);expect(random.scenario.constraints).toEqual(before.scenario.constraints);expect(random.scenario.pallet).toEqual(before.scenario.pallet);expect(random.scenario.generation.seed).not.toBe(before.scenario.generation.seed);expect(random.scenario.types).not.toEqual(before.scenario.types);expect(random.scenario.types).toHaveLength(30);
 await page.getByRole('button',{name:'현재 재고 모아서 실행',exact:true}).click();await expect(page.getByRole('button',{name:'Ⅱ 일시정지',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Ⅱ 일시정지',exact:true}).click();
 const same=await exported(page);expect(same.scenario.types).toEqual(random.scenario.types);expect(same.scenario.constraints).toEqual(random.scenario.constraints);expect(same.runId).not.toBe(random.runId);
});

test('mixed repeated SKU example uses standing poses and real support surfaces',async({page})=>{
 test.setTimeout(150000);await page.goto('/?palletDemo=mixed#pallet');await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');
 await expect(page.locator('.pallet-status')).toContainText('남은 재고 배치 불가',{timeout:120000});
 const result=await exported(page);expect(result.metrics.count).toBeGreaterThan(15);expect(result.scenario.generation.assortment).toBe('repeated');expect(result.scenario.generation.totalCount).toBe(48);expect(result.patternEvaluation.valid).toBe(true);expect(result.frame.placements.some((b:any)=>typeof b.orientation==='string')).toBe(true);
 expect(result.frame.placements.some((b:any)=>b.position.z>0)).toBe(true);expect(result.frame.placements.every((b:any)=>b.supportRatio>=.95-1e-6)).toBe(true);
 writeFileSync('docs/pallet-spatial-mixed-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),scenario:result.scenario,metrics:result.metrics,placements:result.frame.placements,patternEvaluation:result.patternEvaluation},null,2));
 await page.getByLabel('후보',{exact:true}).uncheck();await page.setViewportSize({width:1440,height:1000});await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-spatial-mixed-scene.png'});
});
