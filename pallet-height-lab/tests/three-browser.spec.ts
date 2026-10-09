import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const ready=async(page:import('@playwright/test').Page)=>{await expect(page.getByTestId('three-score')).toBeVisible();await expect(page.getByTestId('three-search-summary')).toContainText('개 첫 수');};
test.beforeEach(async({page})=>{await page.goto('/#3d');await ready(page);});
test('renders WebGL, clears four planes and restores the complete board with undo',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.getByTestId('three-scene')).toHaveAttribute('data-renderer','webgl');
  await expect(page.getByRole('img',{name:'회전 가능한 3D 테트리스 보드'})).toBeVisible();
  await expect(page.getByTestId('three-shaft-ready')).toHaveText('4개');
  await expect(page.locator('.three-candidate-list .chosen')).toContainText('삭제 4면');
  await page.getByRole('button',{name:'위에서',exact:true}).click();await expect(page.getByRole('button',{name:'위에서',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'입체',exact:true}).click();
  mkdirSync('screenshots',{recursive:true});await page.screenshot({path:'screenshots/3d-lab-desktop.png'});
  await page.getByRole('button',{name:'한 수 놓기',exact:true}).click();await expect(page.getByTestId('three-placed')).toHaveText('1');await expect(page.getByTestId('three-cleared')).toHaveText('4');await ready(page);
  await expect(page.getByTestId('three-shaft-ready')).toHaveText('0개');await expect(page.getByTestId('three-holes')).toHaveText('0');
  await page.getByRole('button',{name:'3D 한 수 되돌리기'}).click();await expect(page.getByTestId('three-placed')).toHaveText('0');await expect(page.getByTestId('three-cleared')).toHaveText('0');await ready(page);
  await expect(page.getByTestId('three-shaft-ready')).toHaveText('4개');expect(errors).toEqual([]);
});
test('manual XYZ rotations, depth movement and placement use actual geometry',async({page})=>{
  await page.getByRole('button',{name:'빈 공간부터 쌓기'}).click();await ready(page);
  await page.getByRole('button',{name:'직접 배치',exact:true}).click();await page.getByRole('combobox',{name:'직접 배치 블록'}).selectOption('V');await ready(page);
  const before=await page.locator('.three-placement').innerText();await page.getByRole('button',{name:'X축 회전'}).click();await expect(page.locator('.three-placement')).not.toHaveText(before);
  await page.getByRole('slider',{name:'직접 배치 x',exact:true}).fill('2');await page.getByRole('slider',{name:'직접 배치 z',exact:true}).fill('2');
  await expect(page.locator('.three-placement')).toContainText('x=2 · z=2');await page.getByRole('button',{name:'한 수 놓기',exact:true}).click();await expect(page.getByTestId('three-placed')).toHaveText('1');await ready(page);
  await expect(page.locator('.three-history')).toContainText('V');await page.getByRole('button',{name:'3D 한 수 되돌리기'}).click();await expect(page.getByTestId('three-placed')).toHaveText('0');
});
test('slice editing, cutaway, holes and board JSON survive an export/import',async({page})=>{
  await page.getByRole('button',{name:'층 안에 숨은 구멍'}).click();await ready(page);await expect(page.getByTestId('three-holes')).toHaveText('1');
  await page.getByRole('slider',{name:'3D 단면 층'}).fill('1');await page.getByLabel('선택한 층 위를 잘라 보기').check();await page.getByLabel('구멍 표시', {exact:true}).check();
  await page.getByLabel('이 층 직접 편집').check();await page.getByRole('button',{name:'셀 x=2 y=1 z=2 비움',exact:true}).click();await expect(page.getByTestId('three-holes')).toHaveText('0');
  await page.getByRole('button',{name:'3D 한 수 되돌리기'}).click();await expect(page.getByTestId('three-holes')).toHaveText('1');await ready(page);
  await page.getByLabel('이 층 직접 편집').uncheck();await page.getByText('3D 보드 JSON 저장 / 불러오기',{exact:true}).click();await page.getByRole('button',{name:'보드 내보내기',exact:true}).click();
  const json=await page.getByRole('textbox',{name:'3D 보드 JSON'}).inputValue();expect(JSON.parse(json).dimension).toBe(3);
  await page.getByRole('button',{name:'보드 불러오기',exact:true}).click();await ready(page);await expect(page.getByTestId('three-holes')).toHaveText('1');
  await page.getByRole('textbox',{name:'3D 보드 JSON'}).fill('{"version":1,"dimension":3,"board":{"width":500}}');await page.getByRole('button',{name:'보드 불러오기',exact:true}).click();await expect(page.getByRole('alert')).toContainText('크기');await expect(page.getByTestId('three-holes')).toHaveText('1');
});
test('switches algorithms, latest worker wins, autoplay pauses and both dimensions are reachable',async({page})=>{
  await page.getByRole('combobox',{name:'3D 알고리즘'}).selectOption('two');await ready(page);await expect(page.locator('.three-candidates')).toContainText('깊이 2수');
  await page.getByRole('combobox',{name:'3D 알고리즘'}).selectOption('beam');await page.getByRole('combobox',{name:'3D 탐색 깊이'}).selectOption('3');await page.getByRole('combobox',{name:'3D 빔 폭'}).selectOption('1');await ready(page);await expect(page.locator('.three-candidates')).toContainText('깊이 3수');
  await page.getByRole('button',{name:'빈 공간부터 쌓기'}).click();await ready(page);await page.getByRole('button',{name:'자동 재생',exact:true}).click();await expect(page.getByTestId('three-placed')).not.toHaveText('0');await page.getByRole('button',{name:'일시정지',exact:true}).click();await ready(page);const index=await page.getByTestId('three-placed').innerText();await page.waitForTimeout(1700);await expect(page.getByTestId('three-placed')).toHaveText(index);
  await page.getByRole('link',{name:'2D 연구실',exact:true}).click();await expect(page.getByTestId('score-total')).toBeVisible();await page.getByRole('button',{name:'3D 시뮬레이터',exact:true}).click();await ready(page);
});
test('works at all required mobile widths without overflow or wrapped clickable labels',async({page})=>{
  for(const width of [320,375,414,768]){
    await page.setViewportSize({width,height:900});await expect(page.getByRole('button',{name:'한 수 놓기',exact:true})).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);expect(overflow,`overflow at ${width}`).toBe(false);
    const wrapped=await page.locator('.three-lab button:not(.three-scenarios button):not(.three-candidate-list button):not(.three-slice-grid button), .three-header nav a').evaluateAll(elements=>elements.filter(el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(!node.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(node);if([...range.getClientRects()].filter(r=>r.width>1&&r.height>1).length>1)return true;}return false;}).map(el=>el.textContent));expect(wrapped).toEqual([]);
  }
  await page.setViewportSize({width:375,height:900});await page.screenshot({path:'screenshots/3d-lab-mobile.png',fullPage:true});
});
