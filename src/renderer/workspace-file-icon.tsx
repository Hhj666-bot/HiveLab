import {Folder,FileText,FileCode,FileImage,FileSpreadsheet} from 'lucide-react';
export function WorkspaceFileIcon({name,directory=false}:{name:string;directory?:boolean}){
 if(directory)return <Folder size={15}/>;
 if(/\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(name))return <FileImage size={15}/>;
 if(/\.(xlsx?|csv|tsv)$/i.test(name))return <FileSpreadsheet size={15}/>;
 return /\.(tsx?|jsx?|json|py|css|html|rs|go|java|sh|ps1|ya?ml|toml)$/i.test(name)?<FileCode size={15}/>:<FileText size={15}/>;
}
