import {isGlmApi} from "./adapters/glm-api";
import {planCapable} from "../shared/plan-mode";
import {CONTEXT_DEFAULT_PERCENT, contextFloor, type ContextUsage} from "../shared/context-usage";
import {deskLoungeSession} from "../shared/lounge-capabilities";
import {withMessageSkills} from "../shared/message-skills";
import {applicableSkills} from '../shared/message-skills';
import {standaloneHookCommand} from '../shared/prompt-framing';
import {skillHash} from './skill-provenance';
import {type RunExecutionActive} from "./run-execution";
import {memberPermissions, zcodeCanWrite} from "../shared/permissions";
import {currentIdentity, observeAccount} from "./compatibility";
import {sameMemberProgram} from "./member-version-status";
import {type RequestedRunConfig} from "../shared/executor-config";
import type {Attachment, AcpExecutor, AdapterContext, MemberProfile, Project, ProviderId, Run, Session, Settings, TimelineEvent} from "../shared/types";
import {isAcpId, personaInstructions} from "../shared/defaults";
import {personaWithCovenant} from "../shared/workspace-covenant";
import {Store} from "./store";
import {buildEnvironment, redact} from "./security";
import {stopOwned} from "./process-supervisor";
import {attachmentPath} from "./attachments";
import {AgentTools} from "./agent-tools";
import type {WriteBoundary, RunStatus, GeneratedImage} from "../shared/types";

const now = () => new Date().toISOString();

export interface RunContextHost {
  require: <T>(entity: string, id: string) => T;
  memberFor: (session: Pick<Session, "provider" | "memberId">) => MemberProfile;
  runConfiguration: (session: Session) => RequestedRunConfig;
  persistRun: (run:Run, change:Partial<Run>) => Run;
  settings: Settings;
  store: Store;
  projectRoomDirectory: (roomId: string | undefined) => string | undefined;
  key: string | undefined;
  active: Map<string, RunExecutionActive>;
  emit: (ctx: AdapterContext, kind: TimelineEvent["kind"], text: string, data?: unknown, fidelity?: TimelineEvent["fidelity"]) => void;
  requestApproval: (ctx: AdapterContext, request: Parameters<AdapterContext["approve"]>[0]) => Promise<{ choice: string; answers?: unknown; }>;
  closed: boolean;
  broadcast: () => void;
  owned: (child: import("node:child_process").ChildProcess) => void;
  roomContextInputs: Map<string, (canRemember: boolean, refreshRules?: boolean) => string>;
  roomContextAttachments: Map<string, () => Attachment[]>;
  agentTools: AgentTools;
}

/** RunContext owns this domain; mutable engine state is read through live host accessors. */
export class RunContext {
  constructor(private host:RunContextHost) {}
  context(run: Run, session: Session): AdapterContext {
    const project = this.host.require<Project>("projects", session.projectId);
    // Model and thinking level: the session's choice, else the member card's, else the executor default.
    const member = this.host.memberFor(session);
    const config = run.requestedConfig ?? this.host.runConfiguration(session);
    if (!run.requestedConfig) {
      run.requestedConfig = config;
      this.host.persistRun(run, { requestedConfig: config });
    }
    const runSettings: Settings = {
      ...this.host.settings,
      models: { ...this.host.settings.models, [run.provider]: config.model },
      efforts: { ...this.host.settings.efforts, [run.provider]: config.effort },
    };
    // A native session identifies conversation history, not an installed program version.
    // Subsequent turns use the currently selected executor, including after old-version cleanup.
    if (run.provider !== "deepseek")
      runSettings.permissions = {
        ...runSettings.permissions,
        [run.provider]: memberPermissions(this.host.settings, member, isAcpId(run.provider) ? this.host.store.get<AcpExecutor>("executors", run.provider) : undefined),
      };
    // User-enabled tea-room work inherits the same member permissions as a desk.
    // Other rooms, auxiliary votes/minutes and automatic speech keep their own limits.
    if (project.kind === "lounge" && !deskLoungeSession(session) && run.provider !== "deepseek")
      runSettings.permissions = {
        ...runSettings.permissions,
        [run.provider]: {
          ...runSettings.permissions[run.provider],
          commands: "deny",
          fileScope: "workspace",
        },
      };
    const external=isAcpId(run.provider)?this.host.store.get<AcpExecutor>('executors',run.provider):undefined;
    if(session.writeMode&&external?.catalogId==='zcode'&&!isGlmApi(external)&&!zcodeCanWrite(runSettings.permissions[external.id]))session={...session,writeMode:false};
    if(run.messageSkills?.length){
      const skillAttachments=standaloneHookCommand(run.input)?[]:applicableSkills(run.messageSkills,run.provider).map(s=>({source:s.source,id:s.id,name:s.name,contentHash:skillHash(s.content),attachedAt:now()}));
      this.host.persistRun(run,{skillAttachments});
    }
    const desk=project.kind!=='lounge'&&!session.purpose&&!session.flowId&&!run.flowOperationId&&!!this.host.store.get('desk_session_links',session.id);
    // Plan turns: Claude reviews inside the turn in its native plan mode; Codex and DSH end the turn with the plan.
    // Sandboxes stay as they are: a native session keeps the permission it was created with, and Codex's Windows
    // read-only sandbox cannot start even read commands. DSH's plan turn loses its write and shell tools instead;
    // Codex relies on its native plan mode with file changes declined. Nothing is approved automatically.
    const plan=!!run.planMode&&desk&&planCapable(run.provider,external?.catalogId)&&run.planProposal?.status!=='approved';
    // The user's context budget: their own limit (never above the model's window) and compaction point.
    const member0 = this.host.store.members().find(m => m.id === session.memberId);
    const contextLimit = session.contextLimit ?? member0?.contextLimit, contextPercent = session.contextPercent ?? member0?.contextPercent;
    const reading = this.host.store.get<ContextUsage>('context_usage', session.id)
      ?? this.host.store.list<ContextUsage>('context_usage').filter(u => u.provider === run.provider && u.window).sort((a, b) => b.at.localeCompare(a.at))[0];
    const window = reading?.window;
    // Only the user's own settings change native behaviour; a point alone applies to the model's window.
    const budgetLimit = contextLimit && (!window || contextLimit <= window) ? contextLimit : window;
    const percent = contextPercent ?? CONTEXT_DEFAULT_PERCENT, prefix = reading?.baseline;
    // A point below the topic's fixed part would make the executor compact every turn; such a default is not applied.
    const contextBudget = desk && budgetLimit && (contextLimit || contextPercent) && budgetLimit * percent / 100 >= contextFloor(prefix) ? { limit: budgetLimit, percent, ...(window ? { window } : {}), ...(prefix ? { prefix } : {}) } : undefined;
    const ctx: AdapterContext = {
      ...(contextBudget ? { contextBudget } : {}),
      run:{...run,input:withMessageSkills(run.input,run.messageSkills,run.provider),...(plan?{planMode:true}:{planMode:undefined})},
      session,
      conversation: project.kind === 'lounge' ? 'room' : desk ? 'desk' : undefined,
      roomProjectDirectory: project.kind === "lounge" ? this.host.projectRoomDirectory(project.roomId) : undefined,
      settings: runSettings,
      persona: personaWithCovenant(personaInstructions(
        member,
        this.host.store.profile(),
        this.host.store.members(),
      ), this.host.store.dataDirectory, runSettings),
      ...(run.attachments?.length
        ? {
            attachments: run.attachments.map((item) => ({
              ...item,
              path: attachmentPath(this.host.store.dataDirectory, item),
            })),
          }
        : {}),
      cwd: session.workspace || project.directory,
      env: buildEnvironment(this.host.settings),
      deepseekKey: this.host.key,
      emit: (kind, text, data, fidelity) => {
        const active = this.host.active.get(run.id);
        if (active?.ctx !== ctx || active.replyExpired) return;
        if (
          (text.trim() &&
            ["delta", "reasoning", "plan", "tool", "output", "image"].includes(
              kind,
            )) ||
          (kind === "message" &&
            text.trim() &&
            !(data as { role?: string } | undefined)?.role)
        )
          active.replyWatchdog?.progress();
        if (
          ["subscription", "account", "api", "none"].includes(
            (data as any)?.auth,
          )
        )
          observeAccount((data as any).auth);
        if (
          (kind === "delta" ||
            (kind === "message" && (data as any)?.source === "assistant")) &&
          text.trim()
        )
          active.metrics?.mark("first-output");
        this.host.emit(ctx, kind, text, data, fidelity);
      },
      approve: (request) => this.host.requestApproval(ctx, request),
      persistNativeSession: (id, nativeHome) => {
        if(!this.host.closed&&this.host.active.get(run.id)?.ctx===ctx&&!this.host.active.get(run.id)?.replyExpired){
          const captured=this.host.store.get<Run>('runs',run.id)?.diagnosticContext;
          this.host.persistRun(run,{nativeSessionId:id,...(captured?{diagnosticContext:{...captured,nativeId:id,...(nativeHome==='shared'?{home:undefined}:{})}}:{})});
        }
        if (
          this.host.closed ||
          session.purpose === "room-hand" ||
          session.purpose === "room-image" ||
          session.purpose === "room-minutes" ||
          session.purpose === "room-mention" ||
          this.host.active.get(run.id)?.ctx !== ctx ||
          this.host.active.get(run.id)?.replyExpired
        )
          return;
        const current = this.host.require<Session>("sessions", session.id);
        const identity=currentIdentity();
        if (
          current.nativeId === id &&
          (!nativeHome || current.nativeHome === nativeHome) &&
          (!identity || sameMemberProgram(identity,current.executorIdentity))
        )
          return;
        this.host.store.put("sessions", session.id, {
          ...current,
          nativeId: id,
          ...(identity
            ? { executorIdentity: identity }
            : {}),
          ...(nativeHome ? { nativeHome } : {}),
          updatedAt: now(),
        });
        this.host.broadcast();
      },
      persistNativePersona: (nativeId, hash) => {
        if (this.host.closed || this.host.active.get(run.id)?.ctx !== ctx || this.host.active.get(run.id)?.replyExpired) return;
        const current = this.host.require<Session>('sessions',session.id);
        if (current.nativeId !== nativeId) return;
        if (current.nativePersona?.nativeId === nativeId && current.nativePersona.hash === hash) return;
        this.host.store.put('sessions',session.id,{...current,nativePersona:{nativeId,hash}});
      },
      invalidateNativeContext: () => {
        if (this.host.active.get(run.id)?.ctx !== ctx || this.host.active.get(run.id)?.replyExpired) return;
        ctx.nativeContextInvalidated = true;
        const current = this.host.require<Session>('sessions', session.id);
        if (current.nativeId) this.host.store.put('sessions', session.id, {
          ...current,
          nativeContext: { nativeId: current.nativeId, turnsSinceRefresh: 0, inputCharsSinceRefresh: 0, ...current.nativeContext, refreshRequired: true },
        });
      },
      progress: () => {
        if (this.host.active.get(run.id)?.ctx === ctx && !this.host.active.get(run.id)?.replyExpired)
          this.host.active.get(run.id)?.replyWatchdog?.progress();
      },
      markDelivery: (delivery, nativeTurnId) => {
        const active = this.host.active.get(run.id);
        if (active?.ctx !== ctx || active.stopping || active.replyExpired)
          return;
        if (delivery === "sent") active.metrics?.mark("sent");
        this.host.persistRun(run, {
          delivery,
          ...(nativeTurnId ? { nativeTurnId } : {}),
        });
        this.host.store.put("outbox", run.id, {
          runId: run.id,
          sessionId: session.id,
          delivery,
          nativeTurnId,
          updatedAt: now(),
        });
      },
      registerProcess: (child) => {
        const active = this.host.active.get(run.id);
        if (active?.ctx !== ctx || active.replyExpired) {
          this.host.owned(child);
          void stopOwned(child, 1000).catch(() => {});
          return;
        }
        active?.children.push(child);
        if (active?.lease?.cached) active.lease.children.add(child);
        if (active?.metrics) active.metrics.processes++;
        this.host.owned(child);
      },
      recordTiming: (phase) => this.host.active.get(run.id)?.metrics?.mark(phase),
      recordConfig: (value) => {
        if (
          this.host.active.get(run.id)?.ctx !== ctx ||
          this.host.active.get(run.id)?.replyExpired
        )
          return;
        const current = this.host.require<Run>("runs", run.id);
        this.host.persistRun(run, {
          effectiveConfig: {
            ...current.effectiveConfig,
            ...redact(value),
            at: now(),
          },
        });
      },
      recordRuntime: (stage, conditions) =>
        this.host.active.get(run.id)?.metrics?.decision(stage, conditions),
    };
    const fresh = this.host.roomContextInputs.get(session.id);
    if (fresh) {
      const rebuildInput = (canRemember: boolean, refreshRules = false) => {
        if (
          this.host.active.get(run.id)?.ctx !== ctx ||
          this.host.active.get(run.id)?.replyExpired
        )
          throw new Error("这轮聊天室回复已结束或隔离，不能重新发送。");
        const text = fresh(canRemember, refreshRules),
          attachments = this.host.roomContextAttachments.get(session.id)?.();
        ctx.run.input = withMessageSkills(text,run.messageSkills,run.provider);
        if (attachments) {
          ctx.run.attachments = attachments;
          ctx.attachments = attachments.length ? attachments.map((item) => ({
            ...item,
            path: attachmentPath(this.host.store.dataDirectory, item),
          })) : undefined;
        }
        this.host.store.put("runs", run.id, {
          ...this.host.require<Run>("runs", run.id),
          input: text,
          ...(attachments ? { attachments } : {}),
        });
        this.host.emit(
          ctx,
          "status",
          refreshRules ? "已补齐本轮会议规则，继续读取未读消息。" : "成员重新开始了聊天，已补齐本次讨论记录，可以继续接话。",
          undefined,
          "derived",
        );
        return ctx.run.input;
      };
      ctx.freshInput = (canRemember) => rebuildInput(canRemember);
      ctx.refreshInput = () => rebuildInput(true, true);
    }
    ctx.operationTools=()=>this.host.agentTools.sharedTools(ctx.run.provider);
    ctx.callOperation=(name,args,signal)=>{
      const active=this.host.active.get(ctx.run.id);if(active?.ctx!==ctx||active.stopping||signal?.aborted)return Promise.reject(Error('当前任务已结束或已取消'));
      return this.host.agentTools.controlTool(ctx.session.id,name,args,signal);
    };
    return ctx;
  }
}
