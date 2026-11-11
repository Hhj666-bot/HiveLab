/** "3", "2-5", "1,3,7-9" → sorted unique 1-based page numbers within 1..count. Empty spec means every page. */
export function parsePages(spec:unknown,count:number,limit=Infinity):number[]{
 if(spec===undefined||spec===null||spec==='')return Array.from({length:Math.min(count,limit)},(_,i)=>i+1);
 const text=typeof spec==='number'?String(spec):typeof spec==='string'?spec.replace(/\s+/g,''):'';
 if(!/^\d+(-\d*)?(,\d+(-\d*)?)*$/.test(text))throw Error('页码格式应为 3、2-5 或 1,3,7-9');
 const pages=new Set<number>();
 for(const piece of text.split(',')){
  const [from,to]=piece.split('-'),start=Number(from),end=to===undefined?start:to===''?count:Number(to);
  if(start<1||end<start)throw Error(`页码范围无效：${piece}`);
  if(start>count)throw Error(`第 ${start} 页不存在，共 ${count} 页`);
  for(let page=start;page<=Math.min(end,count);page++){pages.add(page);if(pages.size>limit)throw Error(`一次最多 ${limit} 页`);}
 }
 return [...pages].sort((a,b)=>a-b);
}
