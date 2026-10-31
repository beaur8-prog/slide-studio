import {expect,test,type Page} from '@playwright/test';

async function fixture(page: Page, failRequest = false) {
  await page.addInitScript(({failRequest}) => {
    const state = {openCalls:0,saveCalls:0,takeCalls:0,failRequest,
      menu:(_action:string)=>{},requested:()=>{},
      finishOpen:(_value:unknown)=>{},failOpen:(_error:Error)=>{},
      finishSave:(_value:unknown)=>{},failSave:(_error:Error)=>{}};
    (window as any).__panels=state;
    window.desktop={platform:'darwin',onMenu:callback=>{state.menu=callback;return()=>{};},
      onOpenRequested:callback=>{state.requested=callback;return()=>{};},
      takeRequestedFile:async()=>{state.takeCalls++;if(state.failRequest)throw Error('QA: OS request failed');return null;},
      openFile:()=>{state.openCalls++;return new Promise((resolve,reject)=>{state.finishOpen=resolve;state.failOpen=reject;});},
      saveFile:()=>{state.saveCalls++;return new Promise((resolve,reject)=>{state.finishSave=resolve;state.failSave=reject;});},
      exportPDF:async()=>null,print:async()=>false,
    };
  },{failRequest});
  await page.goto('http://127.0.0.1:5190');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
}

test('open chooser shows waiting, ignores repeated commands and preserves edits after cancellation and failure',async({page})=>{
  await fixture(page);
  const name=page.getByRole('textbox',{name:'프레젠테이션 이름'});
  await name.fill('보존할 편집 내용');
  await page.evaluate(()=>{const s=(window as any).__panels;for(const action of ['open','open','save-as','present','new'])s.menu(action);});
  await expect(page.getByRole('status').filter({hasText:'파일 열기 선택창을 기다리고 있습니다'})).toBeVisible();
  expect(await page.evaluate(()=>{const s=(window as any).__panels;return[s.openCalls,s.saveCalls];})).toEqual([1,0]);
  await expect(page.getByTestId('presentation-view')).toHaveCount(0);
  await page.evaluate(()=>(window as any).__panels.finishOpen(null));
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  await expect(name).toHaveValue('보존할 편집 내용');
  await page.evaluate(()=>(window as any).__panels.menu('open'));
  await expect(page.locator('.busy-backdrop')).toBeVisible();
  await page.evaluate(()=>(window as any).__panels.failOpen(Error('QA: panel failed')));
  await expect(page.locator('.toast')).toContainText('panel failed');
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  await page.evaluate(()=>(window as any).__panels.menu('open'));
  await expect.poll(()=>page.evaluate(()=>(window as any).__panels.openCalls)).toBe(3);
  await page.evaluate(()=>(window as any).__panels.finishOpen(null));
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  await expect(name).toHaveValue('보존할 편집 내용');
});

test('Save As waiting and duplicate guards are released on both cancellation and errors',async({page})=>{
  await fixture(page);
  const name=page.getByRole('textbox',{name:'프레젠테이션 이름'});
  await name.fill('취소해도 남는 문서');
  for(const outcome of ['cancel','error','cancel']){
    const count=await page.evaluate(()=>(window as any).__panels.saveCalls);
    await page.evaluate(()=>{const s=(window as any).__panels;s.menu('save-as');s.menu('save-as');s.menu('open');});
    await expect(page.getByRole('status').filter({hasText:'파일 저장 위치 선택창을 기다리고 있습니다'})).toBeVisible();
    expect(await page.evaluate(()=>{const s=(window as any).__panels;return[s.saveCalls,s.openCalls];})).toEqual([count+1,0]);
    await page.evaluate(outcome=>{const s=(window as any).__panels;if(outcome==='error')s.failSave(Error('QA: save panel failed'));else s.finishSave(null);},outcome);
    await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    if(outcome==='error')await expect(page.locator('.toast')).toContainText('save panel failed');
    await expect(name).toHaveValue('취소해도 남는 문서');
  }
});

test('a failed OS file request does not retry until a new request arrives',async({page})=>{
  await fixture(page,true);
  const frames=()=>page.evaluate(async()=>{for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);});
  await expect(page.locator('.toast')).toContainText('OS request failed');
  await frames();
  expect(await page.evaluate(()=>(window as any).__panels.takeCalls)).toBe(1);
  await page.evaluate(()=>(window as any).__panels.requested());
  await frames();
  expect(await page.evaluate(()=>(window as any).__panels.takeCalls)).toBe(2);
  await page.evaluate(()=>{const s=(window as any).__panels;s.failRequest=false;s.requested();});
  await frames();
  expect(await page.evaluate(()=>(window as any).__panels.takeCalls)).toBe(3);
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
});
