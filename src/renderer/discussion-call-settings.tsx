import {t} from './i18n';
import type {Settings} from '../shared/types';
import {DEFAULT_DISCUSSION_LIMITS,type DiscussionCallLimit} from '../shared/discussion-budget';

export function DiscussionCallSettings({settings,onChange}:{settings:Settings;onChange:(limits:NonNullable<Settings['discussionCallLimits']>)=>void}){
  const limits={...DEFAULT_DISCUSSION_LIMITS,...settings.discussionCallLimits};
  function update(style:'chat'|'work',patch:Partial<DiscussionCallLimit>){onChange({...limits,[style]:{...limits[style],...patch}});}
  return <section aria-label={t("对话调用次数设置")}>
    <h3>{t("对话调用次数")}</h3>
    <p className="settings-description">{t("按每条用户消息的一轮正式发言计数。举手、格式补正、连接重试和会议纪要另记调用次数，不占正式发言额度。达到上限后暂停，继续或发送新消息开启下一轮。")}</p>
    {(['chat','work'] as const).map(style=><div className="field" key={style}>
      <label>{style==='chat'?t("闲聊模式"):t("开会模式")}<select aria-label={style==='chat'?t("闲聊调用次数"):t("开会调用次数")} value={limits[style].mode} onChange={e=>update(style,{mode:e.target.value as DiscussionCallLimit['mode']})}>
        <option value="unlimited">{t("无限制{0}", style==='chat'?t("（默认）"):'')}</option>
        <option value="per-member">{t("每轮每人 2 次{0}", style==='work'?t("（默认）"):'')}</option>
        <option value="custom">{t("自定义整轮总次数")}</option>
      </select></label>
      {limits[style].mode==='custom'&&<label>{t("整轮正式发言次数")}<input aria-label={style==='chat'?t("闲聊自定义次数"):t("开会自定义次数")} type="number" min={1} max={1000} step={1} value={limits[style].calls} onChange={e=>update(style,{calls:Number(e.target.value)})}/></label>}
    </div>)}
    <small>{t("适用于茶歇室、项目会议、个人工位和圆桌中的讨论。项目执行与评审按各自工作阶段运行；后台定时任务继续使用独立的每日预算。")}</small>
  </section>;
}
