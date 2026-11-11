import {t} from './i18n';
const labels:Record<string,string>={get title(){return t("标题")},get concept(){return t("构思")},get visualDirection(){return t("视觉风格")},get storyboard(){return t("分镜")},get scenes(){return t("场景")},get duration(){return t("时长")},get durationSeconds(){return t("时长（秒）")},get time(){return t("时间")},get action(){return t("动作")},get description(){return t("说明")},get characters(){return t("角色")},get deliverables(){return t("成果")},get implementation(){return t("制作方案")},get technicalPlan(){return t("制作方案")},get steps(){return t("步骤")},get nextSteps(){return t("下一步")},get notes(){return t("说明")},get summary(){return t("概要")},get proposal(){return t("方案")},get synthesis(){return t("综合方案")},get objective(){return t("目标")},get scope(){return t("范围")},get acceptanceCriteria(){return t("交付要求")},get rounds(){return t("工作阶段")},get tasks(){return t("任务")},get goal(){return t("目标")},get inputs(){return t("输入材料")},get completionCriteria(){return t("完成要求")},get allowedPaths(){return t("文件范围")},get text(){return t("内容")},get name(){return t("名称")},get role(){return t("角色")},get palette(){return t("配色")},get fps(){return t("帧率")},get aspectRatio(){return t("画幅")},get music(){return t("音乐")},get soundEffects(){return t("音效")},get constraints(){return t("要求")},get implementationNotes(){return t("制作说明")},get openQuestions(){return t("待确认事项")},get visuals(){return t("画面")},get dialogue(){return t("对白")},get narration(){return t("旁白")},get animation(){return t("动画")},get background(){return t("背景")},get frameRange(){return t("帧区间")}};
const internal=new Set(['protocol','version','kind','turn','revision','slotId','recommendedSlotId','sessionId','runId','operationId','artifactId','fingerprint','baselineId','eventIds','evidence','criteriaResults','verificationComplete','validationSummary','systemNotes','source','provenance','inputLimits','id','key','projectId','flowId','planId','roundId','memberId','reviewerMemberId','createdAt','updatedAt','status','dependencies','roundKey']);
/** A display projection, never a replacement for saved evidence or protocol validation. */
export function contentMarkdown(value:unknown,depth=2):string{
  if(typeof value==='string')return value;
  if(value===null||value===undefined)return '';
  if(typeof value!=='object')return String(value);
  if(Array.isArray(value))return value.map((item,index)=>typeof item==='object'?`### ${index+1}\n\n${contentMarkdown(item,Math.min(depth+1,6))}`:`- ${contentMarkdown(item,depth)}`).join('\n\n');
  const object=value as Record<string,unknown>;
  if(object.protocol==='hivelab.project-flow'&&object.payload)return contentMarkdown(object.payload,depth);
  const payload='body' in object||'proposal' in object||'synthesis' in object||'userSummary' in object||'summary' in object&&('findings' in object||'evidence' in object||Object.keys(object).length===1);
  if(payload)for(const key of ['body','proposal','synthesis','userSummary','summary'])if(object[key]!==undefined&&object[key]!==null&&object[key]!=='')return contentMarkdown(object[key],depth);
  return Object.entries(object).filter(([key])=>!internal.has(key)).map(([key,item])=>{
    const body=contentMarkdown(item,Math.min(depth+1,6));return body?`${'#'.repeat(depth)} ${labels[key]??key}\n\n${body}`:'';
  }).filter(Boolean).join('\n\n');
}
export function readableContent(text:string){
  const trimmed=text.trim(),fence=trimmed.match(/^```(?:json)?\s*\n([\s\S]*)\n```$/i),raw=fence?.[1]??trimmed;
  if(!raw.startsWith('{')&&!raw.startsWith('['))return text;
  try{const value=JSON.parse(raw);return contentMarkdown(value)||t("暂无可展示的正文。");}catch{return text;}
}
const RUN_STATUS:Record<string,string>={get rate_limited(){return t("额度用完")},get failed(){return t("运行失败")},get blocked(){return t("被拦下")},get aborted(){return t("中途停止")},get unknown(){return t("结果未知")},get stopped(){return t("已停止")}};
/** Errors written for members and the program, rephrased for the person reading the card. The saved text is unchanged. */
export function plainFlowError(text:string|undefined){
  if(!text)return '';
  const correction=/^格式补正([^。]*)。/.exec(text);
  if(correction)return t("成员整理回复格式时{0}，这次整理没有被采用。", correction[1].replace(/^不能/,'试图'));
  if(text.startsWith('最后的 JSON 回复不完整'))return t("成员交回的结果格式不完整（常见是结尾少了括号），这次没有收下。");
  if(text.startsWith('命令声明没有相符的实际完成记录'))return t("成员写的命令在实际运行记录里找不到对应，这份意见暂未采用。");
  const run=/^成员运行未完成：([a-z_]+)；未自动重发。$/.exec(text);
  if(run)return run[1]==='rate_limited'?t("成员的额度用完了，这次没有做完，也没有自动重发。额度恢复后可以点“接着做”。"):t("成员这次没有做完（{0}），没有自动重发。", RUN_STATUS[run[1]]??run[1]);
  return text;
}
/** Joins items that may already end in punctuation without doubling it (no “。、” or “。；”). */
export function joinClauses(items:readonly string[],separator:string){
  return items.map(item=>item.trim().replace(/[。；，、.;,]+$/,'')).filter(Boolean).join(separator);
}
