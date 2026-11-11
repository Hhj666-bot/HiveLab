// CSV quoting also applies to TSV exports: doubled quotes and embedded newlines.
export function delimitedRows(content:string,delimiter:string){
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const pushCell=()=>{if(row.length<80)row.push(cell);cell='';};
 for(let i=0;i<content.length;i++){
  const char=content[i];
  if(char==='"'&&(quoted||!cell)){if(quoted&&content[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&char===delimiter)pushCell();
  else if(!quoted&&(char==='\r'||char==='\n')){pushCell();rows.push(row);row=[];if(char==='\r'&&content[i+1]==='\n')i++;if(rows.length===500)return rows;}
  else cell+=char;
 }
 if(cell||row.length||(content.length&&!/[\r\n]$/.test(content))){pushCell();rows.push(row);}
 return rows;
}
