import { userQuestions } from "../shared/user-questions";
import { AgentControl, controlToolsForPlatform } from "./agent-control";
import { readSharedFile, editSharedFile } from "./shared-files";
import { roomProjectFiles } from "./adapters/chat-policy";
import { Extensions } from "./extensions";
import { SharedPluginBridge } from "./shared-plugin-bridge";
import { PendingChanges } from "./pending-changes";
import { type RunExecutionActive } from "./run-execution";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AdapterContext,
  PermissionMember,
  Approval,
  MemberProfile,
  ProviderInfo,
  Run,
  Session,
  TimelineEvent,
} from "../shared/types";
import { Store } from "./store";
import { resolveSafePath } from "./security";
import { attachmentPath } from "./attachments";
import type { EngineTiming } from "./engine-options";
import {skillHash} from './skill-provenance';
import type { Subagents } from "./subagents";
import { SUBAGENT_ALLOWED_TOOLS, SUBAGENT_TOOLS, SUBAGENT_TOOL_NAMES } from "../shared/subagents";

export interface AgentToolsHost {
  readonly extensions: Extensions;
  readonly sharedPlugins: SharedPluginBridge;
  readonly store: Store;
  readonly active: Map<string, RunExecutionActive>;
  readonly answer: (params: { id: string; choice: string }) => unknown;
  readonly emit: (
    ctx: AdapterContext,
    kind: TimelineEvent["kind"],
    text: string,
    data?: unknown,
    fidelity?: TimelineEvent["fidelity"],
  ) => void;
  readonly providers: ProviderInfo[];
  readonly pendingChanges: PendingChanges;
  readonly memberFor: (session: Pick<Session, "provider" | "memberId">) => MemberProfile;
  readonly timing: EngineTiming | undefined;
  readonly broadcast: () => void;
  readonly schedule: () => Promise<void>;
  readonly invoke: (method: string, params?: any) => Promise<unknown>;
  readonly alive: boolean;
  readonly subagents: Subagents;
}

const CONTROL_TOOLS = controlToolsForPlatform();
/** Card fields a member may change on their own card through update_persona. */
const SELF_PERSONA_FIELDS = ["voice", "quirks", "routine"];

/** Owns agent tools state and lifecycle. */
export class AgentTools {
  constructor(private host: AgentToolsHost) {}

  agentControl = new AgentControl(
    (sessionId) =>
      this.host.alive &&
      ([...this.host.active.values()].some((a) => a.ctx.session.id === sessionId && !a.stopping) ||
        !!this.host.subagents.bySession(sessionId)),
    (sessionId, name, args, signal) => this.controlTool(sessionId, name, args, signal),
    (sessionId) => this.toolsFor(sessionId),
  );

  /** A subagent sees only reading tools; an eligible main agent also gets the subagent tools. */
  toolsFor(sessionId: string) {
    if (this.host.subagents.isSubagentSession(sessionId)) {
      const live = this.host.subagents.bySession(sessionId);
      return live ? this.sharedTools(live.record.provider).filter((tool) => SUBAGENT_ALLOWED_TOOLS.includes(tool.name)) : [];
    }
    const provider = [...this.host.active.values()].find((a) => a.ctx.session.id === sessionId && !a.stopping)?.ctx.run.provider;
    return [...this.sharedTools(provider), ...(this.host.subagents.eligibleSession(sessionId) ? SUBAGENT_TOOLS : [])];
  }

  computerLease?: string;

  computerApproving?: string;

  computerGrants = new Set<string>();

  sharedTools(provider?: string) {
    return [
      ...this.host.extensions.tools(CONTROL_TOOLS, provider),
      ...this.host.sharedPlugins.tools(),
    ];
  }

  async controlTool(
    sessionId: string,
    name: string,
    args: any,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.host.subagents.isSubagentSession(sessionId)) {
      const live = this.host.subagents.bySession(sessionId);
      if (!live) throw Error("子代理已结束");
      if (!SUBAGENT_ALLOWED_TOOLS.includes(name)) throw Error("子代理只能使用读取文件和技能的工具");
      return this.controlTool(live.record.parentSessionId, name, args, signal);
    }
    if (SUBAGENT_TOOL_NAMES.includes(name)) {
      if (!this.host.subagents.eligibleSession(sessionId)) throw Error("当前任务不能派出子代理");
      if (name === "subagent_models") return this.host.subagents.models(sessionId);
      if (name === "subagent_start") return this.host.subagents.start(sessionId, args);
      if (name === "subagent_wait") return this.host.subagents.wait(sessionId, args, signal);
      return this.host.subagents.stop(String(args?.id ?? ""), "主代理停止了这个子代理", sessionId);
    }
    const actor = this.host.store.get<Session>("sessions", sessionId);
    if (!actor) throw Error("会话不存在");
    // Until the plan is approved, a plan turn produces no files through the shared tools either.
    const planning = [...this.host.active.values()].find((a) => a.ctx.session.id === sessionId && !a.stopping && a.ctx.run.planMode);
    if (planning && ["create_file", "edit_file"].includes(name) && this.host.store.get<Run>("runs", planning.ctx.run.id)?.planProposal?.status !== "approved")
      throw Error("计划模式：计划批准前不能生成或修改文件，请先把计划交给用户审阅");
    const provider =
      [...this.host.active.values()].find((a) => a.ctx.session.id === sessionId && !a.stopping)?.ctx
        .run.provider ?? actor.provider;
    if (!this.sharedTools(provider).some((t) => t.name === name))
      throw Error("工具未知、插件已停用或与当前执行端不兼容");
    if (["skills", "read_skill", "read_skill_asset"].includes(name)) {
      const result=this.host.extensions.skillTool(name, args);
      const active=[...this.host.active.values()].find(a=>a.ctx.session.id===sessionId&&!a.stopping&&!a.replyExpired);
      if(name==='read_skill'&&active&&!signal?.aborted){
        const skill=result as {id:string;path:string;content:string};
        this.host.emit(active.ctx,'status','已按需读取技能：'+skill.id,{hivelabSkillRead:{id:skill.id,path:skill.path,contentHash:skillHash(skill.content)}},'derived');
      }
      return result;
    }
    const shared = this.host.sharedPlugins.external(name),
      external = shared ?? this.host.extensions.external(name, provider);
    if (external) {
      const active = [...this.host.active.values()].find(
        (a) => a.ctx.session.id === sessionId && !a.stopping,
      );
      if (!active || signal?.aborted) throw Error("任务已结束");
      const ctx = active.ctx;
      if (ctx.settings.permissions[ctx.run.provider as PermissionMember]?.mode !== "full") {
        if (
          this.host.store
            .list<Approval>("approvals")
            .some((a) => a.runId === ctx.run.id && a.state === "pending")
        )
          throw Error("请先回应已有的确认问题");
        const promise = ctx.approve({
          type: "approval",
          title: `运行插件：${external.item.name}`,
          detail: `工具 ${external.tool.name} 将运行本地插件代码。插件以当前 Windows 用户运行，独立进程不等于系统沙箱。只运行你信任的插件。`,
          options: [
            { id: "allow", label: "允许本次" },
            { id: "deny", label: "拒绝" },
          ],
          allowChoice: "allow",
          denyChoice: "deny",
          category: "hivelab.plugin",
        });
        const approval = this.host.store
            .list<Approval>("approvals")
            .find(
              (a) =>
                a.runId === ctx.run.id && a.state === "pending" && a.category === "hivelab.plugin",
            ),
          cancel = () => {
            if (approval)
              try {
                this.host.answer({ id: approval.id, choice: "deny" });
              } catch {}
          };
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        let reply;
        try {
          reply = await promise;
        } finally {
          signal?.removeEventListener("abort", cancel);
        }
        if (reply.choice !== "allow") throw Error("用户拒绝运行插件");
      }
      if (active.stopping || !this.host.active.has(ctx.run.id) || signal?.aborted)
        throw Error("任务已停止");
      const controller = new AbortController(),
        timer = setInterval(() => {
          if (active.stopping || !this.host.active.has(ctx.run.id)) controller.abort();
        }, 100);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const toolCallId = randomUUID();
      this.host.emit(
        ctx,
        "tool",
        `插件：${external.item.name} · ${external.tool.name}`,
        { toolCallId, name, hivelabPhase: "running" },
        "native",
      );
      try {
        return await (shared
          ? this.host.sharedPlugins.call(name, args, controller.signal)
          : this.host.extensions.callExternal(
              name,
              args,
              { sessionId, runId: ctx.run.id, provider },
              controller.signal,
            ));
      } finally {
        clearInterval(timer);
        signal?.removeEventListener("abort", abort);
        this.host.emit(
          ctx,
          "tool",
          "插件调用结束",
          { toolCallId, name, hivelabPhase: "completed" },
          "native",
        );
      }
    }
    if (name === "status")
      return {
        providers: this.host.providers.map(({ id, name, available, stale, capabilities }) => ({
          id,
          name,
          available,
          stale,
          capabilities,
        })),
        runs: this.host.store
          .list<Run>("runs")
          .filter((r) => ["queued", "running", "waiting_user", "stopping"].includes(r.status))
          .map(({ id, sessionId, status }) => ({ id, sessionId, status })),
        pendingChanges: this.host.pendingChanges.list(),
      };
    if (name === "members")
      return this.host.store
        .members()
        .map(({ id, name, executor, persona, motto, relations, talkativeness }) => ({
          id,
          name,
          executor,
          persona,
          motto,
          relations,
          talkativeness,
        }));
    if (name === "ask_user") {
      const active = [...this.host.active.values()].find(
        (a) => a.ctx.session.id === sessionId && !a.stopping,
      );
      if (!active) throw Error("当前任务已结束");
      const questions = userQuestions(
        args.questions ?? [{ id: "answer", question: args.question, options: args.options ?? [] }],
      );
      const pendingBefore = new Set(
        this.host.store
          .list<Approval>("approvals")
          .filter((a) => a.runId === active.ctx.run.id && a.state === "pending")
          .map((a) => a.id),
      );
      if (pendingBefore.size) throw Error("请先回应已有的确认问题。");
      const promise = active.ctx.approve({
        type: "question",
        category: "hivelab.explicit-question",
        title: `${this.host.memberFor(actor).name} 需要你确认`,
        detail: questions.map((q) => q.question).join("\n"),
        questions,
        options: [
          { id: "answer", label: "提交选择" },
          { id: "cancel", label: "取消" },
        ],
      });
      const approval = this.host.store
        .list<Approval>("approvals")
        .find(
          (a) => a.runId === active.ctx.run.id && a.state === "pending" && !pendingBefore.has(a.id),
        );
      const cancel = () => {
        if (approval)
          try {
            this.host.answer({ id: approval.id, choice: "cancel" });
          } catch {}
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      let reply;
      try {
        reply = await promise;
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
      return {
        cancelled: reply.choice === "cancel",
        answers: reply.choice === "cancel" ? {} : reply.answers,
      };
    }
    if (name === "read_file" || name === "edit_file") {
      const active = [...this.host.active.values()].find(
        (a) => a.ctx.session.id === sessionId && !a.stopping,
      );
      if (!active || signal?.aborted) throw Error("当前任务已结束或已取消");
      const ctx = active.ctx;
      const sources = ["path", "fileId", "attachmentId"].filter(
        (key) => typeof args[key] === "string" && args[key],
      );
      if (sources.length !== 1) throw Error("来源须三选一：path、fileId 或 attachmentId");
      let target: string;
      // Members often pass an attachment's absolute path; accept it when it is one of this turn's attachments.
      const attached =
        sources[0] === "path" && path.isAbsolute(args.path)
          ? ctx.attachments?.find(
              (a) =>
                path.resolve(attachmentPath(this.host.store.dataDirectory, a)).toLowerCase() ===
                path.resolve(args.path).toLowerCase(),
            )
          : undefined;
      if (attached) target = attachmentPath(this.host.store.dataDirectory, attached);
      else if (sources[0] === "path")
        target = resolveSafePath(roomProjectFiles(ctx) ?? ctx.cwd, args.path);
      else if (sources[0] === "attachmentId") {
        const attachment = ctx.attachments?.find((a) => a.id === args.attachmentId);
        if (!attachment) throw Error("附件不在本轮授权范围内");
        target = attachmentPath(this.host.store.dataDirectory, attachment);
      } else {
        const file = this.host.store.get<{ id: string; name: string; sessionId: string }>(
          "generated_files",
          args.fileId,
        );
        const owner = file && this.host.store.get<Session>("sessions", file.sessionId);
        if (
          !file ||
          !(
            file.sessionId === sessionId ||
            (actor.roomThreadId && owner?.roomThreadId === actor.roomThreadId)
          )
        )
          throw Error("文件不在当前会话或话题中");
        if (!/^[a-f0-9-]{36}$/.test(file.id) || path.basename(file.name) !== file.name)
          throw Error("文件记录无效");
        target = resolveSafePath(
          path.join(this.host.store.dataDirectory, "generated-files"),
          path.join(file.id, file.name),
        );
      }
      const toolCallId = randomUUID();
      this.host.emit(
        ctx,
        "tool",
        name === "read_file" ? "读取文件" : "编辑并生成文件副本",
        { toolCallId, name, hivelabPhase: "running" },
        "native",
      );
      try {
        if (name === "read_file") {
          const { bytes, ...result } = await readSharedFile(target, {
            pages: args.pages,
            sheet: args.sheet,
            rows: args.rows,
            render: args.render,
          });
          if (active.stopping || signal?.aborted) throw Error("当前任务已停止");
          this.host.emit(
            ctx,
            "tool",
            "文件读取结束",
            { toolCallId, name, hivelabPhase: "completed" },
            "native",
          );
          return result;
        }
        if (!this.host.timing?.hostOperation) throw Error("此执行服务没有连接文件交付工具");
        const revised = await editSharedFile(target, args);
        if (active.stopping || !this.host.active.has(ctx.run.id) || signal?.aborted)
          throw Error("当前任务已停止");
        const result = await this.host.timing.hostOperation(
          "bytes" in revised ? "file.importWord" : "file.create",
          {
            runId: ctx.run.id,
            args:
              "bytes" in revised
                ? { name: args.name ?? revised.name, base64: revised.bytes.toString("base64") }
                : {
                    name: args.name ?? revised.name,
                    format: revised.format,
                    language: revised.language,
                    content: revised.content,
                  },
          },
        );
        this.host.store.put("generated_files", result.id, {
          ...result,
          runId: ctx.run.id,
          sessionId,
        });
        this.host.emit(
          ctx,
          "output",
          `已生成修改副本：${result.name}`,
          { generatedFile: result },
          "native",
        );
        this.host.emit(
          ctx,
          "tool",
          "文件副本已保存",
          { toolCallId, name, hivelabPhase: "completed" },
          "native",
        );
        this.host.broadcast();
        return {
          ...result,
          replacements: revised.replacements,
          originalUnchanged: true,
          previewUrl: "hivelab-file://" + result.id,
        };
      } catch (error) {
        this.host.emit(
          ctx,
          "tool",
          "文件操作失败",
          { toolCallId, name, hivelabPhase: "failed" },
          "native",
        );
        throw error;
      }
    }
    if (name === "open_browser") {
      const active = [...this.host.active.values()].find(a => a.ctx.session.id === sessionId && !a.stopping);
      if (!active || signal?.aborted) throw Error("当前任务已结束或已取消");
      if (!this.host.timing?.hostOperation) throw Error("此执行服务没有连接侧边浏览器");
      const ctx = active.ctx,toolCallId = randomUUID();
      this.host.emit(ctx,"tool","在侧栏打开网页",{toolCallId,name,hivelabPhase:"running",arguments:{url:args.url}},"native");
      try {
        const result=await this.host.timing.hostOperation("browser.open",{runId:ctx.run.id,args:{url:args.url}});
        this.host.emit(ctx,"tool","侧栏浏览器调用结束",{toolCallId,name,hivelabPhase:"completed"},"native");
        return result;
      } catch(error) {
        this.host.emit(ctx,"tool","侧栏浏览器调用失败",{toolCallId,name,hivelabPhase:"failed"},"native");
        throw error;
      }
    }
    if (name === "create_file" || name === "computer" || name === "desktop") {
      const active = [...this.host.active.values()].find(
        (a) => a.ctx.session.id === sessionId && !a.stopping,
      );
      if (!active || signal?.aborted) throw Error("当前任务已结束或已取消");
      const ctx = active.ctx;
      if (!this.host.timing?.hostOperation) throw Error("此执行服务没有连接桌面工具");
      const screen = name === "computer" || name === "desktop";
      if (screen) {
        if (
          this.host.store
            .list<Approval>("approvals")
            .some((a) => a.runId === ctx.run.id && a.state === "pending")
        )
          throw Error("请先回应本轮已有的确认问题");
        if (this.computerLease && !this.host.active.has(this.computerLease))
          this.computerLease = undefined;
        if (this.computerLease && this.computerLease !== ctx.run.id)
          throw Error("另一位成员正在操作电脑，请等其任务结束");
        // Each tool keeps its own per-run grant: reading window contents is a different permission from mouse and keyboard.
        const grant = name === "desktop" ? "desktop:" + ctx.run.id : ctx.run.id;
        if (!this.computerGrants.has(grant)) {
          if (this.computerApproving) throw Error("已有电脑授权正在等待回应");
          this.computerApproving = ctx.run.id;
          try {
            const mode = ctx.settings.permissions[ctx.run.provider as PermissionMember]?.mode;
            if (mode !== "full") {
              const reply = await ctx.approve({
                type: "approval",
                title: name === "desktop" ? "允许这轮任务读取和操作窗口界面？" : "允许这轮任务操作电脑？",
                detail: name === "desktop"
                  ? `${this.host.memberFor(actor).name} 将读取打开的窗口中的文字和控件，并点击、填写、选择其中的控件，目标窗口可能被带到前台。授权限于当前任务，可以随时通过顶部提示条停止。`
                  : `${this.host.memberFor(actor).name} 将查看主屏幕并使用鼠标、键盘。授权限于当前任务，可以随时通过顶部提示条停止。`,
                allowChoice: "allow",
                denyChoice: "deny",
                category: "hivelab.computer",
                categoryLabel: "电脑操作",
                options: [
                  { id: "allow", label: "允许本轮" },
                  { id: "deny", label: "拒绝" },
                ],
              });
              if (reply.choice !== "allow") throw Error(name === "desktop" ? "用户拒绝界面操作" : "用户拒绝电脑操作");
            }
            if (!this.host.active.has(ctx.run.id) || active.stopping || signal?.aborted)
              throw Error("本轮已停止或请求已取消");
            this.computerGrants.add(grant);
          } finally {
            this.computerApproving = undefined;
          }
        }
        this.computerLease = ctx.run.id;
      }
      if (!this.host.active.has(ctx.run.id) || active.stopping || signal?.aborted)
        throw Error("本轮已停止");
      const toolCallId = randomUUID();
      this.host.emit(
        ctx,
        "tool",
        name === "computer" ? `电脑操作：${args.action}` : name === "desktop" ? `界面操作：${args.action}` : "生成可下载文件",
        {
          toolCallId,
          name,
          hivelabPhase: "running",
          computerUse: screen,
          arguments:
            screen
              ? { action: args.action }
              : { name: args.name, format: args.format },
        },
        "native",
      );
      try {
        const result = await this.host.timing.hostOperation(
          screen ? name : "file.create",
          name === "desktop"
            ? { runId: ctx.run.id, memberKey: actor.memberId ?? actor.provider, args }
            : { runId: ctx.run.id, args },
        );
        if (name === "create_file") {
          this.host.store.put("generated_files", result.id, {
            ...result,
            runId: ctx.run.id,
            sessionId,
          });
          this.host.emit(
            ctx,
            "output",
            `已生成：${result.name}`,
            { generatedFile: result },
            "native",
          );
          this.host.broadcast();
        }
        return name === "create_file"
          ? { ...result, previewUrl: "hivelab-file://" + result.id }
          : result;
      } finally {
        this.host.emit(
          ctx,
          "tool",
          name === "computer" ? "电脑操作结束" : name === "desktop" ? "界面操作结束" : "文件生成结束",
          { toolCallId, name, hivelabPhase: "completed", computerUse: screen },
          "native",
        );
      }
    }
    const member = this.host.store.members().find((m) => m.id === args.memberId);
    if (!member) throw Error("成员不存在");
    if (name === "update_persona") {
      // Members refine only their own tone, gestures and habits; identity, names and relations stay the user's.
      if (member.id !== (actor.memberId ?? actor.provider))
        throw Error("只能微调自己的人物卡；其他成员的设定请用户在“设置 → 人物设定”中修改");
      const patch = args.patch;
      if (
        !patch ||
        typeof patch !== "object" ||
        Array.isArray(patch) ||
        !Object.keys(patch).length ||
        Object.keys(patch).some((k) => !SELF_PERSONA_FIELDS.includes(k))
      )
        throw Error("只能修改 voice（语气与小动作）、quirks（小习惯）和 routine（日常）；人设、名字、关系和发言积极度由用户在“设置 → 人物设定”中修改");
      const job = this.host.pendingChanges.enqueue({
        method: "team.save",
        params: { member: { ...member, ...patch, id: member.id } },
        label: `${member.name} 的人物设定`,
      });
      void this.host.schedule();
      return job;
    }
    if (name === "create_topic") {
      if (
        [...this.host.active.values()].some(
          (a) => (a.ctx.session.memberId ?? a.ctx.session.provider) === member.id,
        )
      )
        throw Error("该成员正在工作，请等空闲后新建话题");
      return this.host.invoke("desk.topic", {
        memberId: member.id,
        title: String(args.title ?? "新话题").slice(0, 80),
      });
    }
    throw Error("未知工具");
  }
}
