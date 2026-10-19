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
