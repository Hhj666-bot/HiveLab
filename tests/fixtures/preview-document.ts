import {docxContent,zipParts} from '../../src/backend/document-output';
import {wordParts} from '../../src/backend/word-document';

export function previewDocument(){
 const parts=wordParts(docxContent('# HiveLab 文档预览\n\n这是一份含表格与图片的 Word 文档。\n\n<script>window.previewInjected=true</script>'));
 const document=parts['word/document.xml'].toString().replace('<w:document ', '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ');
 const table='<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>'+[['文件类型','预览状态'],['Markdown','渲染与源码'],['Word','表格、图片与段落']].map(row=>'<w:tr>'+row.map(text=>'<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
 const drawing='<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1143000" cy="571500"/><wp:docPr id="1" name="内嵌图片"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="内嵌图片"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1143000" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
 parts['word/document.xml']=Buffer.from(document.replace('<w:sectPr>',table+drawing+'<w:altChunk r:id="rIdUnsafe"/><w:sectPr>'));
 parts['word/_rels/document.xml.rels']=Buffer.from(parts['word/_rels/document.xml.rels'].toString().replace('</Relationships>','<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/><Relationship Id="rIdUnsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="unsafe.html"/></Relationships>'));
 parts['[Content_Types].xml']=Buffer.from(parts['[Content_Types].xml'].toString().replace('</Types>','<Default Extension="png" ContentType="image/png"/><Default Extension="html" ContentType="text/html"/></Types>'));
 parts['word/media/image.png']=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG3sAAAAASUVORK5CYII=','base64');
 parts['word/unsafe.html']=Buffer.from('<script>window.previewInjected=true</script><div>UNSAFE_ALTCHUNK</div>');
 return zipParts(parts);
}
