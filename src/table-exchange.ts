import {tableToClipboard,tableFromHTML,type StudioTable,type StudioStyle} from './studio-table.mjs';
import {tableCellStyle,createTable,validateTable,MAX_TABLE_ROWS,MAX_TABLE_COLUMNS} from './table';
import {pasteTableClipboard} from './table-clipboard';
import type {TableData,TableCellFormat} from './types';
const sides=['top','right','bottom','left'] as const;
export function copyStudioTable(table:TableData,range={startRow:0,endRow:table.cells.length-1,startColumn:0,endColumn:table.cells[0].length-1},size?:{width:number;height:number}){
  const cells=table.cells.slice(range.startRow,range.endRow+1).map((row,r)=>row.slice(range.startColumn,range.endColumn+1).map((text,c)=>{
    const s=tableCellStyle(table,range.startRow+r,range.startColumn+c),style:StudioStyle={background:s.fill,color:s.color,fontFamily:s.fontFamily,fontSize:s.fontSize*0.75,bold:s.bold,italic:s.italic,underline:s.underline,align:s.align,verticalAlign:s.verticalAlign,borders:{}};
    sides.forEach((side,i)=>{const edge=s.borders?.[i];style.borders![side]={width:edge?.width??s.borderWidth,color:edge?.color??s.borderColor,line:'solid'};});return {text,style};
  }));
  const merges=(table.merges||[]).filter(m=>m.row>=range.startRow&&m.column>=range.startColumn&&m.row+m.rowSpan-1<=range.endRow&&m.column+m.columnSpan-1<=range.endColumn).map(m=>({...m,row:m.row-range.startRow,column:m.column-range.startColumn}));
  const weights=(values:number[]|undefined,count:number,total:number)=>{const source=Array.from({length:count},(_,i)=>values?.[i]||1),sum=source.reduce((a,b)=>a+b,0);return source.map(n=>n/sum*total);};
  return tableToClipboard({cells,merges,columnWidths:weights(table.columnWidths,table.cells[0].length,size?.width||table.cells[0].length*90).slice(range.startColumn,range.endColumn+1),rowHeights:weights(table.rowHeights,table.cells.length,size?.height||table.cells.length*25).slice(range.startRow,range.endRow+1)});
}
function cellFormat(s:StudioStyle={}):TableCellFormat{
  return {fill:s.background||'#ffffff',color:s.color||'#222222',fontFamily:s.fontFamily||'Arial',fontSize:(s.fontSize||11)/0.75,bold:!!s.bold,italic:!!s.italic,underline:!!s.underline,align:['left','center','right'].includes(s.align||'')?s.align as TableCellFormat['align']:'left',verticalAlign:['top','middle','bottom'].includes(s.verticalAlign||'')?s.verticalAlign as TableCellFormat['verticalAlign']:'middle',borders:sides.map(side=>{const edge=s.borders?.[side];return {width:edge?.width||0,color:edge?.color||'transparent'};}) as TableCellFormat['borders']};
}
export function readStudioTable(html:string):TableData|null{
  const source=tableFromHTML(html,{maxRows:MAX_TABLE_ROWS,maxColumns:MAX_TABLE_COLUMNS,maxCells:MAX_TABLE_ROWS*MAX_TABLE_COLUMNS,maxText:50000});if(!source)return null;
  return validateTable({...createTable(source.cells.length,source.cells[0].length),header:false,striped:false,autoRows:false,cells:source.cells.map(row=>row.map(cell=>cell.text)),cellStyles:source.cells.map(row=>row.map(cell=>cellFormat(cell.style))),merges:source.merges,columnWidths:source.columnWidths,rowHeights:source.rowHeights});
}
export function pasteStudioTable(target:TableData,row:number,column:number,source:TableData):TableData{
  const rows=source.cells.length,columns=source.cells[0].length;
  const overlaps=(target.merges||[]).filter(m=>m.row<row+rows&&m.row+m.rowSpan>row&&m.column<column+columns&&m.column+m.columnSpan>column);
  if(overlaps.some(m=>m.row<row||m.column<column||m.row+m.rowSpan>row+rows||m.column+m.columnSpan>column+columns))throw Error('대상 병합 셀 전체를 포함하는 위치에 붙여넣으세요.');
  const next=pasteTableClipboard(target,row,column,source.cells);
  return validateTable({...next,cellStyles:next.cells.map((r,ri)=>r.map((_,ci)=>ri>=row&&ri<row+rows&&ci>=column&&ci<column+columns?source.cellStyles?.[ri-row]?.[ci-column]||null:next.cellStyles?.[ri]?.[ci]||null)),merges:[...(target.merges||[]).filter(m=>!overlaps.includes(m)),...(source.merges||[]).map(m=>({...m,row:m.row+row,column:m.column+column}))]});
}
