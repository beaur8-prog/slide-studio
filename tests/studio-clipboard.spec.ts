import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const rich=JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/studio-table.json'),'utf8'));
test('Sheet table HTML becomes an editable native table and copies back with merges/styles',async({page})=>{
 await page.goto('http://127.0.0.1:5190');await expect(page.locator('.save-indicator')).toHaveText('저장됨');
 await page.getByTestId('slide-canvas').click({position:{x:10,y:10}});
 const count=await page.locator('.editable-slide [data-type=table]').count();
 await page.evaluate(rich=>{const data=new DataTransfer();data.setData('text/plain',rich.text);data.setData('text/html',rich.html);window.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},rich);
 const tables=page.locator('.editable-slide [data-type=table]');await expect(tables).toHaveCount(count+1);await expect(tables.last()).toContainText('보고서');await expect(tables.last()).toContainText('줄1');await expect(tables.last().locator('[data-row="0"][data-column="0"]')).toHaveCSS('background-color','rgb(255, 242, 204)');
 await page.keyboard.press('ControlOrMeta+z');await expect(tables).toHaveCount(count);await page.keyboard.press('ControlOrMeta+Shift+z');await expect(tables).toHaveCount(count+1);
 const result=await page.evaluate(async html=>{
   const {readStudioTable,copyStudioTable,pasteStudioTable}=await import('/src/table-exchange.ts');const {createTable}=await import('/src/table.ts');
   const table=readStudioTable(html)!;const output=copyStudioTable(table);const round=readStudioTable(output.html)!;const target=createTable(3,3);target.cells[2][2]='untouched';const pasted=pasteStudioTable(target,0,0,table);
   let invalid='';try{readStudioTable('<table><tr><td colspan="99999">bad</td></tr></table>');}catch(e){invalid=(e as Error).message;}
   const safe=readStudioTable('<table><tr><td onclick="alert(1)"><script>globalThis.__bad=1</script><img src="https://invalid.invalid/pixel">safe</td></tr></table>');
   return {table,round,pasted,text:output.text,invalid,safe,bad:(window as any).__bad};
 },rich.html);
 expect(result.table.merges).toEqual([{row:0,column:0,rowSpan:1,columnSpan:2}]);expect(result.table.cellStyles![0][0]!.fontSize).toBeCloseTo(16/0.75);expect(result.round.cellStyles![0][0]!.fill).toBe('#FFF2CC');expect(result.round.cells[1][0]).toBe('줄1\n줄2');expect(result.pasted.cells[2][2]).toBe('untouched');expect(result.invalid).toBeTruthy();expect(result.safe!.cells[0][0]).toBe('safe');expect(result.bad).toBeUndefined();
 await page.screenshot({path:'test-results/studio-table-paste.png'});
});

test('the shared table parser checks the UTF-8 HTML limit before parsing', async ({ page }) => {
 await page.goto('http://127.0.0.1:5190');
 const message=await page.evaluate(async()=>{
   const {readStudioTable}=await import('/src/table-exchange.ts');
   const html='<table><tr><td>'+'가'.repeat(Math.ceil(10*1024*1024/3))+'</td></tr></table>';
   try { readStudioTable(html); return ''; } catch(error) { return (error as Error).message; }
 });
 expect(message).toContain('10 MB');
});

test('rich tables take precedence over an accompanying clipboard preview image', async ({page}) => {
 await page.goto('http://127.0.0.1:5190');
 await expect(page.locator('.save-indicator')).toHaveText('저장됨');
 await page.getByTestId('slide-canvas').click({position:{x:10,y:10}});
 const tables=page.locator('.editable-slide [data-type=table]');
 const images=page.locator('.editable-slide [data-type=image]');
 const before={tables:await tables.count(),images:await images.count()};
 await page.evaluate(rich=>{
  const data=new DataTransfer(); data.setData('text/html',rich.html);data.setData('text/plain',rich.text);
  data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDagAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'preview.png',{type:'image/png'}));
  window.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
 },rich);
 await expect(tables).toHaveCount(before.tables+1);
 await expect(images).toHaveCount(before.images);
 await expect(tables.last()).toContainText('보고서');
});

for (const change of ['slide','document','focus','modal','gap'] as const) {
 test(`a delayed Home paste is cancelled after a ${change} change`,async({page})=>{
  await page.goto('http://127.0.0.1:5190');await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  // Fresh documents now contain one title slide; explicitly create the target.
  if(change==='slide') {
   await page.getByRole('button',{name:'새 슬라이드',exact:true}).click();
   await page.locator('.thumbnail-button').first().click();
  }
  await page.getByTestId('slide-canvas').click({position:{x:10,y:10}});
  await page.evaluate(rich=>{
   Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:()=>new Promise(resolve=>{
    (window as any).finishClipboardRead=()=>resolve([{types:['text/html','text/plain'],getType:async(type:string)=>new Blob([type==='text/html'?rich.html:rich.text],{type})}]);
   })});
  },rich);
  await page.getByRole('button',{name:'붙여넣기',exact:true}).click();
  if(change==='slide') await page.getByRole('button',{name:/^슬라이드 2:/}).click();
  if(change==='document') await page.getByRole('button',{name:'새 슬라이드',exact:true}).click();
  if(change==='focus') await page.getByRole('textbox',{name:'프레젠테이션 이름',exact:true}).focus();
  if(change==='gap') await page.getByRole('button',{name:'첫 슬라이드 앞에 삽입',exact:true}).click();
  if(change==='modal') {
   await page.getByRole('button',{name:'삽입',exact:true}).click();
   await page.getByRole('button',{name:'표',exact:true}).click();
  }
  await page.evaluate(()=>(window as any).finishClipboardRead());
  await expect(page.locator('.toast')).toContainText('다시 붙여넣으세요');
  await expect(page.locator('.editable-slide [data-type=table]')).toHaveCount(0);
  if(change==='focus') await expect(page.getByRole('textbox',{name:'프레젠테이션 이름',exact:true})).toBeFocused();
 });
}

test('Home paste uses one ClipboardItem and supports plain-text-only browser access',async({page})=>{
 await page.goto('http://127.0.0.1:5190');await expect(page.locator('.save-indicator')).toHaveText('저장됨');
 await page.getByTestId('slide-canvas').click({position:{x:10,y:10}});
 await page.evaluate(()=>{
  Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:async()=>[
   {types:['text/html','text/plain'],getType:async(type:string)=>new Blob([type==='text/html'?'<p>같은 항목</p>':'같은 항목'],{type})},
   {types:['text/plain'],getType:async()=>new Blob(['다른 항목'],{type:'text/plain'})},
  ]});
 });
 await page.getByRole('button',{name:'붙여넣기',exact:true}).click();
 await expect(page.locator('.editable-slide')).toContainText('같은 항목');
 await expect(page.locator('.editable-slide')).not.toContainText('다른 항목');
 await page.getByTestId('slide-canvas').click({position:{x:10,y:10}});
 await page.evaluate(()=>{
  Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:undefined});
  Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:async()=>'일반 텍스트\n둘째 줄'});
 });
 await page.getByRole('button',{name:'붙여넣기',exact:true}).click();
 await expect(page.locator('.editable-slide')).toContainText('일반 텍스트');
 await expect(page.locator('.editable-slide')).toContainText('둘째 줄');
});

test('a denied native paste reports the keyboard alternative without an unhandled rejection',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5190');await expect(page.locator('.save-indicator')).toHaveText('저장됨');
 await page.evaluate(()=>{(window as any).desktop={onMenu:()=>()=>{},pasteTableClipboard:async()=>{throw Error('denied');}};});
 await page.getByRole('button',{name:'붙여넣기',exact:true}).click();
 await expect(page.locator('.toast')).toContainText('붙여넣으세요');
 expect(errors).toEqual([]);
});

test('external table paste protects partial target merges and replaces a complete range in one undo',async({page})=>{
 await page.goto('http://127.0.0.1:5190');await expect(page.locator('.save-indicator')).toHaveText('저장됨');
 const paste=async(html:string,text='外部 표')=>page.evaluate(({html,text})=>{
  const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);
  window.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
 },{html,text});
 await page.getByTestId('slide-canvas').click({position:{x:10,y:10}});
 await paste(rich.html,rich.text);
 const table=page.locator('.editable-slide [data-type=table]').last();
 const anchor=table.locator('[data-row="0"][data-column="0"]');
 await anchor.click();
 await paste('<table><tr><td>겹치는 붙여넣기</td></tr></table>');
 await expect(page.locator('.toast')).toContainText('대상 병합 셀 전체');
 await expect(table).toContainText('보고서');
 await expect(table).not.toContainText('겹치는 붙여넣기');
 await paste(rich.html.replace('보고서','교환한 표'),rich.text.replace('보고서','교환한 표'));
 await expect(table).toContainText('교환한 표');
 await expect(table.locator('[data-row][data-column]')).toHaveCount(3);
 await expect(anchor).toHaveCSS('background-color','rgb(255, 242, 204)');
 await page.keyboard.press('ControlOrMeta+z');
 await expect(table).toContainText('보고서');
 await expect(table).not.toContainText('교환한 표');
 await page.keyboard.press('ControlOrMeta+Shift+z');
 await expect(table).toContainText('교환한 표');
});
