export interface StudioEdge { width: number; line: 'solid'|'dashed'|'dotted'|'double'; color: string }
export interface StudioStyle { background?: string; color?: string; fontFamily?: string; fontSize?: number; bold?: boolean; italic?: boolean; underline?: boolean; align?: string; verticalAlign?: string; borders?: Partial<Record<'top'|'right'|'bottom'|'left',StudioEdge|null>> }
export interface StudioTable { cells: {text:string;style?:StudioStyle}[][]; merges?: {row:number;column:number;rowSpan:number;columnSpan:number}[]; columnWidths?: number[];rowHeights?: number[] }
export function tableToClipboard(table:StudioTable):{text:string;html:string};
export function tableFromHTML(html:string,limits?:{maxRows?:number;maxColumns?:number;maxCells?:number;maxText?:number}):StudioTable|null;
export function colorHex(value:unknown,fallback?:string):string;
