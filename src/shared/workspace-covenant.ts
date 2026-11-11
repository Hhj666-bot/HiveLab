import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** 公约文件的默认模板 */
export const DEFAULT_COVENANT = `---
version: 1.0
created: ${new Date().toISOString().split('T')[0]}
user_title: {{USER_TITLE}}
---

# HiveLab 合屋工作公约

> **版本：** 1.0
> **生效日期：** ${new Date().toISOString().split('T')[0]}
> **用户称呼说明：** 本公约中的「{{USER_TITLE}}」指代实际用户
> **适用范围：** 合屋全体成员，包括以后新加入的成员，不论使用哪个执行端
> **修订权限：** 可在 HiveLab 设置中直接修改本文件

---

## 1️⃣ 文件交付规则

### 1.1 交付物要让 {{USER_TITLE}} 看得见、能预览

**交给 {{USER_TITLE}} 的文件（文档、方案、清单、报告、代码、图片），必须在回复里以可预览的文档卡片出现。** 只写进磁盘、回复里只给一个路径，不算交付。具体用哪个工具生成卡片，按 HiveLab 每轮提供的工具清单执行。

### 1.3 禁止行为

❌ **禁止交付物只写盘、不出卡片**
❌ **禁止用大段粘贴代替文件卡片**（超过几十行的文档、代码要生成文件）

---

## 7️⃣ 工具使用规范

### 7.1 工具怎么用，以工具清单为准

HiveLab 自带工具的用法（交付文件、读写文件、打开网页、操作窗口、向 {{USER_TITLE}} 提问等）由 HiveLab 在每轮开头提供的「工具清单」说明，本公约不重复，也不改变它。执行端自带的工具按执行端自己的说明使用。

### 7.2 工具失败后的处理

**正确流程：**
1. 记录错误信息（完整的错误消息）
2. 尝试备用方案（如果有）
3. 向 {{USER_TITLE}} 汇报："尝试了 A，遇到 xxx 错误；尝试了 B，遇到 yyy 错误。建议 zzz 或请确认权限。"

**禁止：**
- ❌ 静默失败（工具报错了，假装成功）
- ❌ 无限重试（同一个方法失败 3 次就换方案）
- ❌ 放弃不报告（"我做不了"然后不说为什么）

---

其余协作规则请在“设置 → 工作公约”里按自己的习惯编写。
`;

export interface CovenantVariables {
  /** 对用户的通用称呼（默认：用户）*/
  userTitle: string;
  /** 工作场景称呼（默认：同 userTitle）*/
  workTitle?: string;
  /** 闲聊场景称呼（默认：同 userTitle）*/
  casualTitle?: string;
}

export interface CovenantDocument { path: string; content: string }

export function readCovenant(dataDirectory: string): CovenantDocument {
  const file = getCovenantPath(dataDirectory);
  if (!existsSync(file)) writeFileSync(file, DEFAULT_COVENANT, 'utf8');
  return { path: file, content: readFileSync(file, 'utf8') };
}

/** 读取并渲染公约 */
export function loadCovenant(
  dataDirectory: string,
  variables: CovenantVariables
): string {
  const raw = readCovenant(dataDirectory).content;

  // 替换变量
  return raw.replace(/\{\{USER_TITLE\}\}/g, variables.userTitle);
}

/** The member card followed by the workspace covenant. Every executor gets both through the run's persona, so a newly added member is covered too. */
export function personaWithCovenant(persona: string, dataDirectory: string, settings: { persona?: { userTitle?: string; workTitle?: string; casualTitle?: string } }): string {
  let covenant = '';
  try { covenant = loadCovenant(dataDirectory, { userTitle: settings.persona?.userTitle || '用户', workTitle: settings.persona?.workTitle, casualTitle: settings.persona?.casualTitle }).trim(); }
  catch { /* An unreadable covenant must not stop the turn; the member card still applies. */ }
  return covenant ? `${persona}\n\n[HiveLab 合屋 工作公约]\n${covenant}` : persona;
}

/** 获取公约文件路径（供设置界面使用）*/
export function getCovenantPath(dataDirectory: string): string {
  return path.join(dataDirectory, 'workspace-covenant.md');
}

/** 保存公约（供设置界面使用）*/
export function saveCovenant(
  dataDirectory: string,
  content: string
): void {
  const covenantPath = getCovenantPath(dataDirectory);
  writeFileSync(covenantPath, content, 'utf8');
}
