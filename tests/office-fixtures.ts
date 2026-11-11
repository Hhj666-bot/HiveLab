import {zipParts} from '../src/backend/document-output';

/** A two-slide deck in non-file order, the first slide with speaker notes. */
export function pptx(){
 const ns='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
 const slide=(text:string[])=>`<p:sld ${ns}><p:cSld><p:spTree>${text.map(t=>`<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
 const rel=(id:string,type:string,target:string)=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
 return zipParts({
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'ppt/presentation.xml':`<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1','slide','slides/slide1.xml')}${rel('rId2','slide','slides/slide2.xml')}</Relationships>`,
  'ppt/slides/slide1.xml':slide(['第二页标题','A &amp; B']),
  'ppt/slides/slide2.xml':slide(['封面']),
  'ppt/slides/_rels/slide2.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1','notesSlide','../notesSlides/notesSlide1.xml')}</Relationships>`,
  'ppt/notesSlides/notesSlide1.xml':`<p:notes ${ns}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>讲者备注</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
 });
}

/** A small, valid PDF: one text line per page; pages listed in `blank` carry no text layer. */
export function pdf(pages:string[]){
 const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 pages.forEach((text,i)=>{
  const stream=text?`BT /F1 24 Tf 72 720 Td (${text}) Tj ET`:'0 0 1 rg 72 600 200 100 re f';
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 });
 let body='%PDF-1.4\n';const offsets:number[]=[];
 objects.forEach((object,i)=>{offsets.push(body.length);body+=`${i+1} 0 obj\n${object}\nendobj\n`;});
 const xref=body.length;
 body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(body,'latin1');
}
