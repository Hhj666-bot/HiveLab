/** Development counterpart of ./jsx-runtime: React's dev runtime with the same display-boundary pass. */
import {Fragment,jsxDEV as reactJsxDEV} from 'react/jsx-dev-runtime';
import {localizeProps} from './jsx-runtime';

export {Fragment};
export type {JSX} from 'react/jsx-dev-runtime';

export function jsxDEV(type:any,props:any,key:any,isStatic:boolean,source?:any,self?:any){
 return reactJsxDEV(type,localizeProps(type,props),key,isStatic,source,self);
}
