import { expect, test } from '@playwright/test';
test('changing a complex rotation to a three-orientation piece never crashes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#3d');await expect(page.getByTestId('three-search-summary')).toContainText('개 첫 수');
  await page.getByRole('button',{name:'빈 공간부터 쌓기'}).click();await expect(page.getByTestId('three-search-summary')).toContainText('개 첫 수');
  await page.getByRole('button',{name:'직접 배치',exact:true}).click();await page.getByRole('combobox',{name:'직접 배치 블록'}).selectOption('L');
  await expect(page.getByTestId('three-search-summary')).toContainText('개 첫 수');
  for(const axis of ['X','Y','Z','X','Y'])await page.getByRole('button',{name:`${axis}축 회전`}).click();
  await page.getByRole('combobox',{name:'직접 배치 블록'}).selectOption('I');await expect(page.getByTestId('three-search-summary')).toContainText('개 첫 수');
  await expect(page.getByRole('button',{name:'한 수 놓기',exact:true})).toBeEnabled();await expect(page.locator('.three-current')).toContainText('3가지 고유 회전');expect(errors).toEqual([]);
});
test('WebGL failure retains working layer inspection and simulation',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){if(type.startsWith('webgl'))return null;return original.apply(this,[type,...args] as never);} as typeof HTMLCanvasElement.prototype.getContext;});
  await page.goto('/#3d');await expect(page.getByTestId('three-scene')).toHaveAttribute('data-renderer','fallback');
  await expect(page.getByText('이 브라우저에서 WebGL을 사용할 수 없습니다.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'한 수 놓기',exact:true})).toBeEnabled();await page.getByRole('button',{name:'한 수 놓기',exact:true}).click();await expect(page.getByTestId('three-cleared')).toHaveText('4');
  await expect(page.getByRole('button',{name:'셀 x=4 y=0 z=4 비움',exact:true})).toBeVisible();
});
