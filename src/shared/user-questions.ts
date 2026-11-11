import {t} from './i18n';
export type UserQuestion={id:string;question:string;header?:string;options:{label:string;description?:string}[];multiSelect?:boolean};
export function userQuestions(value:unknown):UserQuestion[]{
  if(!Array.isArray(value)||!value.length||value.length>8)throw Error(t("请提供 1–8 个需要确认的问题。"));
  const result=value.map((raw:any,index)=>{
    if(!raw||typeof raw!=='object'||typeof raw.question!=='string'||!raw.question.trim()||raw.question.length>2000)throw Error(t("问题内容无效。"));
    const options=raw.options??[];if(!Array.isArray(options)||options.length>12)throw Error(t("每个问题最多提供 12 个选项。"));
    const normalized=options.map((o:any)=>{const label=typeof o==='string'?o:o?.label;if(typeof label!=='string'||!label.trim()||label.length>180)throw Error(t("选项内容无效。"));return {label:label.trim(),...(typeof o?.description==='string'?{description:o.description.slice(0,1000)}:{})};});
    if(new Set(normalized.map(o=>o.label)).size!==normalized.length)throw Error(t("问题选项不能重复。"));
    return {id:typeof raw.id==='string'?raw.id.slice(0,100):'q'+index,question:raw.question.trim(),...(typeof raw.header==='string'?{header:raw.header.slice(0,40)}:{}),options:normalized,multiSelect:raw.multiSelect===true};
  });if(new Set(result.map(q=>q.id)).size!==result.length)throw Error(t("问题编号不能重复。"));return result;
}
export function hasQuestionAnswers(questions:{key:string}[],answers:Record<string,unknown>){return questions.length?questions.every(q=>Array.isArray(answers[q.key])?(answers[q.key] as unknown[]).some(v=>typeof v==='string'&&v.trim()):typeof answers[q.key]==='string'&&Boolean((answers[q.key] as string).trim())):typeof answers.answer==='string'&&Boolean(answers.answer.trim());}
