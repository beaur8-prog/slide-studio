// Studio table clipboard v1: inert HTML plus quoted TSV. No executable content
// or workbook formulas travel through this format. Keep the vendored copy in
// Slide Studio identical; docs/STUDIO-CLIPBOARD.md describes the contract.
const sides=['top','right','bottom','left'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function colorHex(value,fallback='#222222'){
  const text=String(value||'').trim();
  if(/^#[\da-f]{6}$/i.test(text))return text;
  if(/^#[\da-f]{3}$/i.test(text))return '#'+[...text.slice(1)].map(c=>c+c).join('');
  const rgb=text.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if(rgb&&rgb.slice(1,4).every(n=>Number(n)<=255))return rgb[4]==='0'?'transparent':'#'+rgb.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join('');
  return text==='transparent'?text:fallback;
}
export function tableText(cells){return cells.map(row=>row.map(cell=>{const text=String(typeof cell==='object'?cell.text:cell);return /[\t\r\n"]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}).join('\t')).join('\n');}
const pixels=value=>{const n=parseFloat(value);return /pt$/i.test(value)?n*4/3:n;};
const number=(value,fallback,min=0,max=10000)=>Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;
const checkHtmlSize=html=>{if(html.length>10*1024*1024||new TextEncoder().encode(html).byteLength>10*1024*1024)throw Error('붙여넣을 표 HTML은 10 MB 이하여야 합니다.');};
export function tableToClipboard(table){
  const {cells,merges=[],columnWidths=[],rowHeights=[]}=table;
  if(!Array.isArray(cells)||!cells.length||!cells[0]?.length||cells.length*cells[0].length>100000)throw Error('복사할 표 크기가 올바르지 않습니다.');
  const covered=new Set(),anchors=new Map();
  for(const m of merges){anchors.set(`${m.row},${m.column}`,m);for(let r=m.row;r<m.row+m.rowSpan;r++)for(let c=m.column;c<m.column+m.columnSpan;c++)if(r!==m.row||c!==m.column)covered.add(`${r},${c}`);}
  const html='<table data-studio-table="1" style="border-collapse:collapse;table-layout:fixed"><colgroup>'+cells[0].map((_,c)=>`<col width="${number(columnWidths[c],90,1)}" style="width:${number(columnWidths[c],90,1)}px">`).join('')+'</colgroup><tbody>'+cells.map((row,r)=>`<tr style="height:${number(rowHeights[r],25,1)}px">`+row.map((cell,c)=>{
    if(covered.has(`${r},${c}`))return '';
    const s=cell.style||{},m=anchors.get(`${r},${c}`),span=m?.columnSpan||1;
    const font=typeof s.fontFamily==='string'&&!/[;{}<>"\\]/.test(s.fontFamily)?s.fontFamily:'Arial';
    let css=`border:0 solid transparent;padding:4px;background-color:${colorHex(s.background,'#ffffff')};color:${colorHex(s.color)};font-family:${font};font-size:${number(s.fontSize,11,1,4096)}pt;font-weight:${s.bold?'bold':'normal'};font-style:${s.italic?'italic':'normal'};text-decoration:${s.underline?'underline':'none'};text-align:${['left','center','right'].includes(s.align)?s.align:'left'};vertical-align:${['top','middle','bottom'].includes(s.verticalAlign)?s.verticalAlign:'middle'};white-space:pre-wrap;`;
    for(const side of sides){const edge=s.borders?.[side];if(edge&&edge.width>0)css+=`border-${side}:${number(edge.width,1,0,1000)}px ${['solid','dotted','dashed','double'].includes(edge.line)?edge.line:'solid'} ${colorHex(edge.color)};`;}
    const widths=Array.from({length:span},(_,i)=>number(columnWidths[c+i],90,1));
    const text=escape(cell.text).replace(/\r\n?/g,'\n').replace(/\n/g,'<br>');
    return `<td${m?` rowspan="${m.rowSpan}" colspan="${m.columnSpan}"`:''} colwidth="${widths.join(',')}" data-colwidth="${widths.join(',')}" style="${escape(css)}"><p style="margin:0;text-align:${['left','center','right'].includes(s.align)?s.align:'left'}"><span style="${escape(css.replace(/border[^;]*;|padding[^;]*;|background-color[^;]*;/g,''))}">${text||'<br>'}</span></p></td>`;
  }).join('')+'</tr>').join('')+'</tbody></table>';
  return {text:tableText(cells),html};
}
function plainText(node){
  if(node.nodeType===3)return node.textContent||'';
  if(node.nodeType!==1)return '';
  if(node.tagName==='BR')return '\n';
  let text=[...node.childNodes].map(plainText).join('');
  if(['P','DIV','LI'].includes(node.tagName))text+='\n';
  return text;
}
function inherited(element,key,table){for(let el=element;el;el=el.parentElement){if(el.style?.[key])return el.style[key];if(el===table)break;}return '';}
/** Parse a detached <template>; never attach clipboard HTML or load resources. */
export function tableFromHTML(html,{maxRows=1000,maxColumns=1000,maxCells=100000,maxText=2000000}={}){
  if(!html)return null;if(typeof html!=='string')throw Error('표 HTML 형식이 올바르지 않습니다.');checkHtmlSize(html);
  const template=document.createElement('template');template.innerHTML=html;
  template.content.querySelectorAll('script,style,iframe,object,embed,svg,math,template,input,textarea,button').forEach(node=>node.remove());
  const table=template.content.querySelector('table');if(!table)return null;
  const rows=[...table.querySelectorAll('tr')].filter(row=>row.closest('table')===table);
  if(!rows.length)return null;if(rows.length>maxRows)throw Error(`표는 ${maxRows}행까지 붙여넣을 수 있습니다.`);
  const cells=[],merges=[],columnWidths=[],rowHeights=[];let totalText=0,width=0;
  for(let r=0;r<rows.length;r++){
    cells[r]??=[];let c=0;rowHeights[r]=number(pixels(rows[r].style.height),25,1);
    for(const td of rows[r].children){if(!['TD','TH'].includes(td.tagName))continue;while(cells[r][c])c++;
      const rowSpan=number(Number(td.getAttribute('rowspan')||1),0,1,maxRows),columnSpan=number(Number(td.getAttribute('colspan')||1),0,1,maxColumns);
      if(!Number.isInteger(rowSpan)||!Number.isInteger(columnSpan)||!rowSpan||!columnSpan||r+rowSpan>rows.length||c+columnSpan>maxColumns||(r+rowSpan)*(c+columnSpan)>maxCells)throw Error('붙여넣을 표 크기 또는 병합 범위가 올바르지 않습니다.');
      const text=plainText(td).replace(/\n$/,'').replace(/^\n$/,'');totalText+=text.length;if(totalText>maxText)throw Error('붙여넣을 표의 글자 수가 너무 많습니다.');
      const walker=document.createTreeWalker(td,4);let textNode;while((textNode=walker.nextNode())&&!textNode.textContent.trim()){}
      const run=textNode?.parentElement||td.querySelector('p')||td;
      const fontSize=inherited(run,'fontSize',table),size=parseFloat(fontSize);
      const style={background:colorHex(inherited(td,'backgroundColor',table),'#ffffff'),color:colorHex(inherited(run,'color',table)),fontFamily:inherited(run,'fontFamily',table).replace(/["']/g,'')||'Arial',fontSize:number(size*(fontSize.endsWith('px')?0.75:1),11,1,4096),bold:/bold|[6-9]00/.test(inherited(run,'fontWeight',table))||!!run.closest('b,strong')||td.tagName==='TH',italic:inherited(run,'fontStyle',table)==='italic'||!!run.closest('i,em'),underline:(inherited(run,'textDecoration',table)+' '+inherited(run,'textDecorationLine',table)).includes('underline')||!!run.closest('u'),align:inherited(td.querySelector('p')||td,'textAlign',table)||'left',verticalAlign:inherited(td,'verticalAlign',table)||'middle',borders:{}};
      for(const side of sides){const key='border'+side[0].toUpperCase()+side.slice(1),line=inherited(td,key+'Style',table)||'none',value=pixels(inherited(td,key+'Width',table));style.borders[side]=line==='none'||line==='hidden'?null:{width:number(value,1,0,1000),line:['solid','dashed','dotted','double'].includes(line)?line:'solid',color:colorHex(inherited(td,key+'Color',table))};}
      const colwidth=(td.getAttribute('colwidth')||td.getAttribute('data-colwidth')||'').split(',').map(Number),cellWidth=number(pixels(td.style.width),90*columnSpan,1)/columnSpan;
      for(let y=r;y<r+rowSpan;y++){cells[y]??=[];for(let x=c;x<c+columnSpan;x++){if(cells[y][x])throw Error('표의 병합 셀이 겹칩니다.');cells[y][x]={text:y===r&&x===c?text:'',style:y===r&&x===c?style:{}};}}
      for(let x=0;x<columnSpan;x++)if(!columnWidths[c+x])columnWidths[c+x]=number(colwidth[x],cellWidth,1);
      if(rowSpan>1||columnSpan>1)merges.push({row:r,column:c,rowSpan,columnSpan});c+=columnSpan;width=Math.max(width,c);
    }
  }
  if(!width)return null;if(rows.length*width>maxCells)throw Error('붙여넣을 표의 셀 수가 너무 많습니다.');
  const cols=[...table.querySelectorAll('col')].filter(col=>col.closest('table')===table);cols.forEach((col,c)=>{if(c<width)columnWidths[c]=number(pixels(col.style.width||col.getAttribute('width')),columnWidths[c]||90,1);});
  return {cells:cells.map(row=>Array.from({length:width},(_,c)=>row[c]||{text:'',style:{}})),merges,columnWidths,rowHeights};
}
