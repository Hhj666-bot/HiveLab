import {hasQuestionAnswers} from "../shared/user-questions";
import { PLAN_TEXT_LIMIT } from "../shared/plan-mode";
import { SUBAGENT_READONLY_COMMAND } from "../shared/subagents";
import {GlmApiAdapter} from "./adapters/glm-api";
import {type RunExecutionActive} from "./run-execution";
import {createHash, randomUUID} from "node:crypto";
import type {Attachment, AdapterContext, PermissionMember, Approval, Collaboration, Project, ProviderId, RoomState, Run, Session, Settings, TimelineEvent} from "../shared/types";
import {AcpAdapter} from "./adapters/acp";
import {ZcodeAdapter} from "./adapters/zcode";
import type {CatalogLoginState} from "../shared/executor-catalog";
import {Store} from "./store";
import {RoomDiscussionController} from "./room-discussion";
import {RoomContexts} from "./room-contexts";
import {redact} from "./security";
import {stopOwned} from "./process-supervisor";
import {RoomRuntimePool} from "./runtime-pool";
import {AutomationScheduler} from "./automation-scheduler";
import {ProjectFlowController} from "./project-flow";
import {MemberWorkspaces} from "./member-workspaces";
import {AgentTools} from "./agent-tools";
import type {WriteBoundary, RunStatus, GeneratedImage} from "../shared/types";

const now = () => new Date().toISOString();

export interface RunControlHost {
  alive: boolean;
  active: Map<string, RunExecutionActive>;
  store: Store;
  emit: (ctx: AdapterContext, kind: TimelineEvent["kind"], text: string, data?: unknown, fidelity?: TimelineEvent["fidelity"]) => void;
  broadcast: () => void;
  approvals: Map<string, { resolve: (v: { choice: string; answers?: unknown; }) => void; reject: (e: Error) => void; }>;
  persistRun: (run:Run, change:Partial<Run>) => Run;
  require: <T>(entity: string, id: string) => T;
  agentTools: AgentTools;
  settings: Settings;
  closed: boolean;
  memberWorkspaces: MemberWorkspaces;
  rooms: RoomContexts;
  discussion: RoomDiscussionController;
  roomRuntimes: RoomRuntimePool;
  executorLoginAdapters: Map<string, GlmApiAdapter | ZcodeAdapter | AcpAdapter>;
  executorLoginStates: Map<string, CatalogLoginState>;
  projectFlow: ProjectFlowController;
  automation: AutomationScheduler;
  roomStopping: boolean;
  pauseCollaboration: (id: string) => { paused: boolean; };
}

/** RunControl owns this domain; mutable engine state is read through live host accessors. */
export class RunControl {
  constructor(private host:RunControlHost) {}
  requestApproval(
    ctx: AdapterContext,
    request: Parameters<AdapterContext["approve"]>[0],
  ): Promise<{ choice: string; answers?: unknown }> {
    if (
      !this.host.alive ||
      !this.host.active.has(ctx.run.id) ||
      this.host.active.get(ctx.run.id)?.stopping ||
      this.host.active.get(ctx.run.id)?.replyExpired
    )
      return Promise.reject(new Error("本轮已停止或结束，不再受理新的审批"));
    const approval: Approval = {
      ...redact(request),
      id: randomUUID(),
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      provider: ctx.run.provider,
      state: "pending",
      createdAt: now(),
    };
    // A plan review is never answered on the user's behalf; the reply's plan card resolves it.
    if (approval.type === "plan")
      this.host.persistRun(ctx.run, { planProposal: { status: "pending", text: approval.detail.slice(0, PLAN_TEXT_LIMIT), approvalId: approval.id, at: now() } });
    // "帮我批准": answer with the member's own allow option when the user set a rule for this session.
    const session = this.host.store.get<Session>("sessions", ctx.session.id);
    const permissionMode=this.host.active.get(ctx.run.id)?.ctx.settings.permissions[ctx.run.provider as PermissionMember]?.mode;
    // Until a plan is approved, every request reaches the user, whatever the session's automatic rules.
    const planning = !!ctx.run.planMode && this.host.store.get<Run>("runs", ctx.run.id)?.planProposal?.status !== "approved";
    // A read-only subagent's command is never covered by blanket rules, only by the user's own "allow this kind" choice.
    const subagentLook = approval.category === SUBAGENT_READONLY_COMMAND;
    const rule =
      !planning &&
      approval.type === "approval" &&
      approval.allowChoice &&
      approval.options.some((x) => x.id === approval.allowChoice)
        ? subagentLook ? (session?.approvalRules?.includes(SUBAGENT_READONLY_COMMAND) ? `本会话允许此类：${approval.categoryLabel || '只读子代理的命令'}` : undefined)
        : permissionMode==='full'?'完全访问':permissionMode==='request'||permissionMode==='assist'?undefined:session?.autoApprove
          ? "本会话全部自动批准"
          : approval.category &&
              session?.approvalRules?.includes(approval.category)
            ? `本会话允许此类：${approval.categoryLabel || approval.category}`
            : undefined
        : undefined;
    if (rule) {
      this.host.store.put("approvals", approval.id, {
        ...approval,
        state: "answered",
        autoApproved: rule,
        answeredChoice: approval.allowChoice,
      });
      this.host.emit(
        ctx,
        "status",
        `已按你的设置自动批准（${rule}）：${approval.title}`,
        { approvalId: approval.id, rule },
        "derived",
      );
      this.host.broadcast();
      return Promise.resolve({ choice: approval.allowChoice! });
    }
    this.host.store.put("approvals", approval.id, approval);
    const reply = new Promise<{ choice: string; answers?: unknown }>(
      (resolve, reject) => this.host.approvals.set(approval.id, { resolve, reject }),
    );
    this.host.persistRun(ctx.run, { status: "waiting_user" });
    this.host.active.get(ctx.run.id)?.replyWatchdog?.waitForUser();
    this.host.emit(
      ctx,
      approval.type === "question" ? "question" : "approval",
      approval.detail,
      approval,
      "native",
    );
    this.host.broadcast();
    return reply;
  }
  answer(params: any) {
    const approval = this.host.require<Approval>("approvals", String(params.id));
    const pending = this.host.approvals.get(approval.id);
    const run = this.host.require<Run>("runs", approval.runId);
    const session = this.host.require<Session>("sessions", approval.sessionId);
    if (
      approval.state !== "pending" ||
      !pending ||
      this.host.active.get(run.id)?.stopping ||
      session.revision !== run.revision
    )
      throw new Error(
        "这项审批或问题已失效，不能使用旧答案。请刷新会话，查看当前待回答的问题。",
      );
    // HiveLab's own controls translate to the member's native allow/deny option.
    let choice = String(params.choice || "answer");
    let stopAfter = false;
    if (
      choice.startsWith("hivelab:") &&
      !approval.options.some((option) => option.id === choice)
    ) {
      if (
        !approval.allowChoice ||
        !approval.options.some((x) => x.id === approval.allowChoice)
      )
        throw new Error("这个请求没有可代为批准的原生选项");
      if (choice === "hivelab:allow-category" && approval.category)
        this.host.store.put("sessions", session.id, {
          ...session,
          approvalRules: [
            ...new Set([...(session.approvalRules ?? []), approval.category]),
          ],
        });
      else if (choice === "hivelab:allow-all")
        this.host.store.put("sessions", session.id, {
          ...session,
          autoApprove: true,
        });
      else if (choice === "hivelab:deny-stop") {
        if (!approval.denyChoice) throw new Error("这个请求没有可用的拒绝选项");
        stopAfter = true;
      } else throw new Error("未知的审批选项");
      choice = stopAfter ? approval.denyChoice! : approval.allowChoice;
    } else if (
      approval.options.length &&
      !approval.options.some((x) => x.id === choice)
    )
      throw new Error("请选择执行端实际提供的选项");
    if(approval.type==='question'&&!['cancel','decline','skip','reject'].includes(choice)){
      const raw=Array.isArray(approval.questions)?approval.questions:[];
      const questions=raw.map((q:any,index:number)=>({key:String(q.id??q.key??q.question??index)}));
      if(!hasQuestionAnswers(questions,params.answers&&typeof params.answers==='object'?params.answers:{}))throw Error('请为每个问题选择一项，或填写自定义回答。');
    }
    this.host.store.put("approvals", approval.id, {
      ...approval,
      state: "answered",
      answeredChoice: choice,
    });
    this.host.approvals.delete(approval.id);
    if (approval.type === "plan") {
      const current = this.host.require<Run>("runs", run.id);
      if (current.planProposal) this.host.persistRun(current, { planProposal: { ...current.planProposal, status: choice === "execute" ? "approved" : "revising", at: now() } });
      if (choice === "execute") {
        const latest = this.host.require<Session>("sessions", session.id), next = { ...latest };
        delete next.planMode;
        this.host.store.put("sessions", session.id, next);
      }
    }
    const stillWaiting=this.host.store.list<Approval>('approvals').some(a=>a.runId===run.id&&a.state==='pending');
    this.host.persistRun(run, { status: stillWaiting?'waiting_user':'running' });
    if(!stillWaiting)this.host.active.get(run.id)?.replyWatchdog?.userAnswered();
    pending.resolve({ choice, answers: params.answers });
    if (stopAfter) void this.stopRun(run.id).catch(() => {});
    this.host.broadcast();
    return { answered: true };
  }
  expireApprovals(runId: string) {
    this.host.agentTools.computerGrants.delete(runId);this.host.agentTools.computerGrants.delete('desktop:'+runId);if(this.host.agentTools.computerLease===runId)this.host.agentTools.computerLease=undefined;
    for (const approval of this.host.store
      .list<Approval>("approvals")
      .filter((x) => x.runId === runId && x.state === "pending")) {
      this.host.store.put("approvals", approval.id, {
        ...approval,
        state: "expired",
      });
      this.host.approvals
        .get(approval.id)
        ?.reject(new Error("本轮已停止或结束，原审批已失效"));
      this.host.approvals.delete(approval.id);
    }
  }
  withdrawQueued(sessionId: string, reason: string) {
    for (const queued of this.host.store
      .list<Run>("runs")
      .filter((x) => x.sessionId === sessionId && x.status === "queued")) {
      this.host.persistRun(queued, {
        status: "stopped",
        delivery: "withdrawn",
        error: reason,
        completedAt: now(),
      });
      const outbox = this.host.store.get<Record<string, unknown>>(
        "outbox",
        queued.id,
      );
      if (outbox)
        this.host.store.put("outbox", queued.id, {
          ...outbox,
          delivery: "withdrawn",
          updatedAt: now(),
        });
    }
  }
  blockSession(sessionId: string, runId: string, reason: string) {
    const session = this.host.require<Session>("sessions", sessionId),
      run = this.host.require<Run>("runs", runId);
    if (session.revision !== run.revision) return; // A late old-direction result cannot withdraw the new direction.
    this.host.store.put("blocked_sessions", sessionId, {
      runId,
      reason,
      createdAt: now(),
    });
    this.withdrawQueued(sessionId, reason);
  }
  async stopRun(runId: string) {
    const run = this.host.require<Run>("runs", runId);
    const active = this.host.active.get(runId);
    if (!active && run.status !== "queued") return;
    this.blockSession(run.sessionId, run.id, "用户停止成员，旧队列不会继续");
    if (run.status === "queued" && !active) {
      this.host.persistRun(run, {
        status: "stopped",
        delivery: "withdrawn",
        completedAt: now(),
      });
      return;
    }
    if (!active) return;
    if (active.stopPromise) return active.stopPromise;
    active.stopping = true;
    this.host.persistRun(run, { status: "stopping" });
    this.expireApprovals(runId);
    this.host.emit(
      active.ctx,
      "status",
      "已收到停止要求，正在等待成员程序取消本轮并退出。",
      undefined,
      "derived",
    );
    active.stopPromise = (async () => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(
          () => resolve("timeout"),
          this.host.settings.stopTimeoutMs,
        );
      });
      const cancellation = Promise.resolve()
        .then(() => active.adapter.stop())
        .catch((error) => {
          if (!this.host.closed)
            this.host.emit(
              active.ctx,
              "warning",
              `取消失败，继续核对进程：${(error as Error).message}`,
              undefined,
              "derived",
            );
        });
      const finished = Promise.all([
        cancellation,
        active.completion ?? Promise.resolve(),
      ]);
      const outcome = await Promise.race([finished, timeout]);
      if (timer) clearTimeout(timer);
      if (outcome === "timeout") {
        await Promise.all(
          active.children.map((child) =>
            stopOwned(child, 2000).catch((error) =>
              this.host.emit(
                active.ctx,
                "warning",
                (error as Error).message,
                undefined,
                "derived",
              ),
            ),
          ),
        );
        if (this.host.active.has(runId))
          this.host.emit(
            active.ctx,
            "warning",
            "成员程序尚未确认完全停止。请查看活动记录；确认前不会启动新任务。",
            undefined,
            "derived",
          );
      }
    })();
    return active.stopPromise;
  }
  memberStopPreview(memberId: string) {
    if (!this.host.store.members().some((m) => m.id === memberId))
      throw new Error("这位成员不存在，请刷新团队。");
    const runs = this.host.store
      .list<Run>("runs")
      .filter((run) => {
        const session = this.host.store.get<Session>("sessions", run.sessionId);
        return (
          session &&
          (session.memberId ?? session.provider) === memberId &&
          (this.host.active.has(run.id) ||
            (!run.completedAt &&
              ["queued", "running", "waiting_user", "stopping"].includes(
                run.status,
              )))
        );
      })
      .map((run) => {
        const session = this.host.store.get<Session>("sessions", run.sessionId)!,
          project = this.host.store.get<Project>("projects", session.projectId),
          roomId = session.roomId ?? project?.roomId;
        const location =
          roomId === "global"
            ? "茶歇室"
            : roomId?.startsWith("roundtable:")
              ? "圆桌"
              : roomId?.startsWith("project:")
                ? "项目会议室"
                : roomId?.startsWith("report:")
                  ? "个人汇报"
                  : this.host.store.get("desk_session_links", session.id) ||
                      roomId?.startsWith("desk:")
                    ? "个人工位"
                    : run.flowOperationId
                      ? "项目工作"
                      : "单人对话";
        return {
          runId: run.id,
          sessionId: session.id,
          status: run.status,
          title: session.title,
          projectName: project?.kind ? undefined : project?.name,
          location,
          updatedAt: run.updatedAt,
        };
      })
      .sort((a, b) => a.runId.localeCompare(b.runId));
    return {
      memberId,
      runs,
      token: createHash("sha256")
        .update(JSON.stringify(runs.map(({ updatedAt, ...run }) => run)))
        .digest("hex"),
    };
  }
  async stopMember(params: Record<string, unknown>) {
    const memberId = String(params.memberId),
      preview = this.memberStopPreview(memberId);
    if (params.confirm !== true || params.token !== preview.token)
      throw new Error("这位成员的运行已变化，请重新查看列表并确认中止。");
    this.host.memberWorkspaces.cancelPending(memberId);
    for (const state of this.host.store.list<RoomState>("room_states")) {
      const roomId = state.roomId ?? "global";
      // Historical states may outlive their project, topic or personal room.
      // They must never block cancellation of this member's live runs.
      try { this.host.store.validateRoomId(roomId); } catch { continue; }
      if (
        state.discussion?.members.includes(memberId) ||
        state.discussion?.mentionQueue?.some((q) => q.memberId === memberId)
      )
        this.host.rooms.run(roomId, () => this.host.discussion.stopMember(memberId));
    }
    await Promise.all(preview.runs.map((run) => this.stopRun(run.runId)));
    await Promise.all(
      preview.runs.map((run) => this.host.roomRuntimes.closeSession(run.sessionId)),
    );
    this.host.broadcast();
    return {
      requested: preview.runs.length,
      remaining: this.memberStopPreview(memberId).runs,
    };
  }
  async stopAll() {
    for (const id of this.host.executorLoginAdapters.keys())
      this.host.executorLoginStates.set(id, {
        phase: "cancelled",
        message: "登录已取消。",
      });
    await Promise.allSettled(
      [...this.host.executorLoginAdapters.values()].map((adapter) => adapter.stop()),
    );
    this.host.memberWorkspaces?.cancelPending();
    this.host.projectFlow?.pauseAll();
    if (this.host.alive) this.host.automation.pause();
    for (const state of this.host.store.list<RoomState>("room_states")) {
      const id = state.roomId ?? "global";
      // Only discussion rooms participate here; personal room shutdown is
      // handled by the run/session cancellation below.
      if (id !== "global" && !id.startsWith("project:") && !id.startsWith("roundtable:")) continue;
      try { this.host.store.validateRoomId(id); } catch { continue; }
      this.host.rooms.run(id, () => {
        this.host.discussion.pause("你已全部停止，等待明确继续。");
        this.host.roomStopping = true;
      });
    }
    for (const collab of this.host.store
      .list<Collaboration>("collaborations")
      .filter((x) => x.status === "running"))
      this.host.pauseCollaboration(collab.id);
    for (const sessionId of new Set(
      this.host.store
        .list<Run>("runs")
        .filter((x) => x.status === "queued")
        .map((x) => x.sessionId),
    ))
      this.withdrawQueued(sessionId, "用户全部停止，旧队列不会继续");
    await Promise.all([...this.host.active.keys()].map((id) => this.stopRun(id)));
    await this.host.roomRuntimes.closeAll();
  }
}
