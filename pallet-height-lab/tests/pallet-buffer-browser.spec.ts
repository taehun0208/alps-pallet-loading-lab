import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
async function exported(page:any){const download=page.waitForEvent('download');await page.getByRole('button',{name:'실행 JSON 저장',exact:true}).click();return JSON.parse(readFileSync((await (await download).path())!,'utf8'));}
test('shows the external buffer, retrieves from it, exports and replays the same inventory',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?palletDemo=buffer#pallet');
 await expect(page.locator('.pallet-status')).toContainText('입고 처리 완료',{timeout:30000});
 const r=await exported(page);expect(r.frame.records.map((v:any)=>v.observation.typeId)).toEqual(['BASE','MID','CAP']);expect(r.metrics.count).toBe(3);expect(r.patternEvaluation.valid).toBe(true);
 await expect(page.getByLabel('임시 대기 및 상단 복귀')).toContainText('상단 복귀 1개');
 const canvas=page.getByTestId('pallet-scene').locator('canvas');await expect(canvas).toHaveAttribute('data-buffer','[]');await expect(canvas).toHaveAttribute('data-arm-visible','true');
 await page.getByRole('slider',{name:'배치 이력'}).fill('1');await expect(page.getByLabel('임시 대기 및 상단 복귀')).toContainText('CAP-01 · 외부 대기 중');
 expect(JSON.parse((await canvas.getAttribute('data-buffer'))!)[0].id).toBe('CAP-01');await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-buffer-waiting.png'});
 await page.getByRole('slider',{name:'배치 이력'}).fill('2');await expect(page.getByLabel('임시 대기 및 상단 복귀')).toContainText('복귀 바닥 높이 350 mm');
 await page.getByRole('button',{name:'이 지점에서 분기',exact:true}).click();await expect(page.getByRole('button',{name:'한 단계',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'재생 속도'}).selectOption('1');
 await expect(page.getByLabel('임시 대기 및 상단 복귀')).toContainText('다음 배치: CAP-01');await page.getByRole('button',{name:'한 단계',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-pickup',JSON.stringify({x:-1300,y:850,z:0}));await expect(page.getByRole('button',{name:'실행 취소',exact:true})).toBeEnabled();await page.getByRole('button',{name:'실행 취소',exact:true}).click();
 const cancelled=await exported(page);expect(cancelled.frame.placements).toHaveLength(2);expect(cancelled.frame.buffer[0].observation.id).toBe('CAP-01');
 await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');await page.getByRole('button',{name:'계속 재생',exact:true}).click();await expect(page.locator('.pallet-status')).toContainText('입고 처리 완료');const completed=await exported(page);
 expect(completed.frame.placements).toEqual(r.frame.placements);expect(completed.frame.buffer).toEqual([]);expect(completed.frame.records.at(-1).path.points[0].label).toContain('임시 대기대');
 await page.getByTestId('pallet-scene').screenshot({path:'docs/pallet-buffer-returned.png'});
 await page.getByRole('button',{name:'초기화',exact:true}).click();await expect(page.getByLabel('임시 대기 및 상단 복귀')).toContainText('임시 대기 0 / 1');const reset=await exported(page);expect(reset.frame.processed).toBe(0);expect(reset.frame.placements).toEqual([]);
 writeFileSync('docs/pallet-buffer-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),scenario:r.scenario,settings:r.settings,metrics:r.metrics,records:r.frame.records.map((v:any)=>({id:v.observation.id,pickup:v.observation.pickupPosition,position:v.placement.position,bufferAfter:v.bufferAfter})),errors},null,2));expect(errors).toEqual([]);
});
test('enables the feature in the current compact simulator and provides an explicit demo and setting',async({page})=>{
 await page.goto('/#pallet');await page.getByRole('button',{name:'임시 보류 예제',exact:true}).click();await page.getByText('탐색 범위 · 점수 가중치',{exact:true}).click();await expect(page.getByRole('checkbox',{name:'임시 보류 후 상단 복귀',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'임시 보류 후 상단 복귀',exact:true}).uncheck();await page.getByRole('button',{name:'설정 적용 · 새 실행',exact:true}).click();await page.getByRole('combobox',{name:'재생 속도'}).selectOption('64');await page.getByRole('button',{name:'▶ 자동 적재',exact:true}).click();await expect(page.locator('.pallet-status')).toContainText('남은 재고 배치 불가');expect((await exported(page)).metrics.count).toBe(1);
});
