import type { Page } from '@playwright/test';
// Freeze legacy browser contracts explicitly; task defaults have a different information/constraint model.
export async function openResearch(page:Page){await page.goto('/#pallet');await page.getByRole('combobox',{name:'입고 시나리오',exact:true}).selectOption('field');await page.getByRole('combobox',{name:'재고 배치 전략',exact:true}).selectOption('size-first');await page.getByRole('combobox',{name:'평가 정책',exact:true}).selectOption('legacy');}
