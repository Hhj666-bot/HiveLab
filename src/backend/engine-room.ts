import {loungeDeskEnabled, type LoungeCapabilityMode} from "../shared/lounge-capabilities";
import {type MessageSkill} from "../shared/message-skills";
import {type RunExecutionActive} from "./run-execution";
import {memberPermissions} from "../shared/permissions";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile} from "node:fs/promises";
import path from "node:path";
import type {Attachment, AdapterContext, MemberProfile, Project, ProviderId, RoomMessage, RoomState, RoomSummary, RoomThread, Run, Session, Settings, TimelineEvent} from "../shared/types";
import {quotaPreference} from "../shared/quota";
import {ROOM_REACTIONS, isRoomPass, reactionText, roomMarkdown, toggleReaction} from "../shared/room";
import {normalizeMember} from "../shared/defaults";
import {Store} from "./store";
import {RoomDiscussionController} from "./room-discussion";
import {RoomContexts} from "./room-contexts";
import type {RoomId} from "../shared/types";
import {isConnectionFailure} from "./adapter-failure";
import {workspaceFingerprint, diffWorkspace} from "./workspace";
import {RoomRuntimePool} from "./runtime-pool";
import {removeCheckpoint} from "./workspace-checkpoint";
import {AutomationScheduler} from "./automation-scheduler";
import type {AutomaticOrigin} from "../shared/automation";
import {describeAttachments, resolveAttachments, withoutPath} from "./attachments";
import {EngineAttachments} from "./engine-attachments";
import {IMAGE_SEND_MAX} from "../shared/attachments";
import {memoryEntries, newMemoryId} from "../shared/memory";
import {ProjectFlowController} from "./project-flow";
import {markRoomRead, roomTaskStatus, workingRoomMember} from "./project-flow-room";
import {MemberWorkspaces} from "./member-workspaces";
import {Roundtables} from "./roundtable";
import {ProviderRegistry} from "./provider-registry";
import {AutomationSpeaker} from "./automation-speaker";
import type {WriteBoundary, RunStatus, GeneratedImage} from "../shared/types";

const now = () => new Date().toISOString();

const RUN_STATUS_TEXT: Partial<Record<Run["status"], string>> = {
  failed: "没能完成",
  unknown: "状态待核对",
  interrupted: "运行中断",
  rate_limited: "额度受限",
  stopped: "已停止",
};

export interface RoomConversationHost {
  settings: Settings;
  alive: boolean;
  rooms: RoomContexts;
  broadcast: () => void;
  store: Store;
  providerRegistry: ProviderRegistry;
  roundtables: Roundtables;
  projectFlow: ProjectFlowController;
  projectRoomDirectory: (roomId: string | undefined) => string | undefined;
  roomRunning: Promise<void> | undefined;
  writeEvent: (ctx: AdapterContext, kind: TimelineEvent["kind"], text: string, data?: unknown, fidelity?: TimelineEvent["fidelity"]) => void;
  context: (run: Run, session: Session) => AdapterContext;
  roomStopping: boolean;
  roomContextInputs: Map<string, (canRemember: boolean, refreshRules?: boolean) => string>;
  roomContextAttachments: Map<string, () => Attachment[]>;
  roomStartChecks: Map<string, () => boolean>;
  send: (sessionId: string, text: string, intent?: "message" | "supplement" | "redirect", automatic?: AutomaticOrigin, attachments?: Attachment[], imageGeneration?: boolean, flowOperationId?: string, supplementId?: string, messageSkills?: MessageSkill[]) => Promise<{ delivery: string; scope: string; activeTaskContinues: boolean; runId?: undefined; deliveryId?: undefined; } | { delivery: string; runId: string; deliveryId: string; scope?: undefined; activeTaskContinues?: undefined; } | { delivery: string; runId: string; scope?: undefined; activeTaskContinues?: undefined; deliveryId?: undefined; }>;
  waitForReply: (runId: string, sessionId: string) => Promise<Pick<RoomMessage, "text" | "status" | "error">>;
  roomId: RoomId;
  roomStore: Store;
  roomChanging: boolean;
  closed: boolean;
  discussion: RoomDiscussionController;
  flowTasks: Set<Promise<void>>;
  require: <T>(entity: string, id: string) => T;
  createSession: (projectId: string, provider: ProviderId, title?: string, writeMode?: boolean, memberId?: string, purpose?: Session["purpose"]) => Session;
  roomRuntimes: RoomRuntimePool;
  persistRun: (run:Run, change:Partial<Run>) => Run;
  attachments: EngineAttachments;
  withdrawQueued: (sessionId: string, reason: string) => void;
  active: Map<string, RunExecutionActive>;
  stopRun: (runId: string) => Promise<void>;
  memberFor: (session: Pick<Session, "provider" | "memberId">) => MemberProfile;
  assertSessionUsable: (session: Session) => void;
  automationSpeaker: AutomationSpeaker;
  automation: AutomationScheduler;
  requireIdle: (sessionId: string, action: string) => void;
  deleteSession: (sessionId: string, discard: boolean, options?: { broadcast?: boolean; }) => Promise<{ deleted: boolean; workspaceRemoved: boolean; }>;
  workspaceOperations: Set<string>;
  workspaceKey: (session: Session) => string;
  removeSessionRecords: (sessionId: string) => Run[];
  memberWorkspaces: MemberWorkspaces;
}

/** RoomConversation owns this domain; mutable engine state is read through live host accessors. */
export class RoomConversation {
  constructor(private host:RoomConversationHost) {}
  createRoomDiscussion(roomId: RoomId, store: Store) {
    return new RoomDiscussionController(store, {
      callLimits: () => this.host.settings.discussionCallLimits,
      alive: () => this.host.alive,
      busy: () =>
        Boolean(
          this.host.rooms.get(roomId).running || this.host.rooms.get(roomId).changing,
        ),
      changed: () => this.host.broadcast(),
      working: (memberId) => workingRoomMember(this.host.store, roomId, memberId),
      taskStatus: (memberId) => roomTaskStatus(this.host.store, roomId, memberId),
      read: (memberId, ids) => markRoomRead(this.host.store, roomId, memberId, ids),
      available: (member) =>
        this.host.providerRegistry.providers.some((p) => p.id === member.executor && p.available),
      quotaPreference: (memberId) => {
        const member = this.host.store
          .members()
          .find((member) => member.id === memberId);
        return member
          ? quotaPreference(
              this.host.providerRegistry.memberQuota(member.executor),
              Date.now(),
              member.model || this.host.settings.models[member.executor],
            )
          : 1;
      },
      launch: (flow) =>
        this.host.rooms.run(roomId, () => this.launchDiscussion(flow)),
      interrupt: () => this.host.rooms.run(roomId, () => this.roomStop()),
      pausePendingHands: () =>
        this.host.rooms.run(roomId, () => this.pausePendingHands()),
      cancelHands: () => this.host.rooms.run(roomId, () => this.cancelHands()),
      attachments: (member, messages) => this.roomAttachments(member, messages),
      minutesInstruction: () =>
        this.host.roundtables?.minutesInstruction(roomId) ?? "",
      minutesMember: () => {
        if (!roomId.startsWith("project:")) return;
        const data = this.host.projectFlow.snapshot(roomId.slice(8));
        return data.overview.stage?.leadMemberId ?? data.flow?.leadMemberId;
      },
      projectFiles: () => this.host.projectRoomDirectory(roomId),
      interruptAndWait: () =>
        this.host.rooms.run(roomId, async () => {
          const running = this.host.roomRunning;
          await this.roomStop(true);
          await running;
        }),
      warning: (runId, text) => {
        const run = this.host.store.get<Run>("runs", runId),
          session = run && this.host.store.get<Session>("sessions", run.sessionId);
        if (run && session)
          this.host.writeEvent(
            this.host.context(run, session),
            "warning",
            text,
            undefined,
            "derived",
          );
      },
      turn: (member, prompt, onRun, options) =>
        this.host.rooms.run(roomId, async () => {
          const session = await this.loungeSession(
            member,
            options?.mention
              ? "room-mention"
              : options?.hand
                ? "room-hand"
                : options?.summary
                  ? "room-minutes"
                  : undefined,
          );
          if (
            this.host.roomStopping ||
            !this.host.alive ||
            options?.shouldStart?.() === false
          )
            return { text: "", status: "stopped" as const };
          if (options?.freshPrompt)
            this.host.roomContextInputs.set(session.id, options.freshPrompt);
          if (options?.attachments)
            this.host.roomContextAttachments.set(session.id, options.attachments);
          if (options?.shouldStart)
            this.host.roomStartChecks.set(session.id, options.shouldStart);
          try {
            const discussionId = store.roomState().discussion?.id;
            const sent = (await this.host.send(
              session.id,
              prompt,
              "message",
              undefined,
              options?.attachments?.() ?? [],
              false,undefined,undefined,options?.messageSkills,
            )) as { runId: string };
            const receipt = this.host.store.get<Run>("runs", sent.runId);
            if (receipt && discussionId)
              this.host.store.put("runs", receipt.id, {
                ...receipt,
                origin: {
                  ...receipt.origin,
                  discussionId,
                  callKind: options?.callKind ?? "normal",
                },
              });
            onRun(sent.runId);
            const result = await this.host.waitForReply(sent.runId, session.id),
              run = this.host.store.get<Run>("runs", sent.runId);
            const connectionFailure =
                run?.status === "failed" &&
                isConnectionFailure(run.error ?? ""),
              retryableConnection =
                connectionFailure && run?.delivery === "prepared";
            if (retryableConnection)
              this.host.writeEvent(
                this.host.context(run!, session),
                "warning",
                "这条消息尚未发出，会议讨论可重试一次连接。",
                undefined,
                "derived",
              );
            return {
              ...result,
              unknown: run?.status === "unknown" || run?.delivery === "unknown",
              limited:
                run?.status === "rate_limited" ||
                run?.stopReason === "rate_limited",
              retryableConnection,
              connectionFailure,
            };
          } finally {
            if (this.host.roomContextInputs.get(session.id) === options?.freshPrompt)
              this.host.roomContextInputs.delete(session.id);
            if (
              this.host.roomContextAttachments.get(session.id) ===
              options?.attachments
            )
              this.host.roomContextAttachments.delete(session.id);
            if (this.host.roomStartChecks.get(session.id) === options?.shouldStart)
              this.host.roomStartChecks.delete(session.id);
          }
        }),
    });
  }
  roomThread(id: string) {
    return this.host.store.roomThread(id, this.host.roomId);
  }
  roomMessageRecord(id: string) {
    const message = this.host.roomStore.get<RoomMessage>("room_messages", id);
    if (!message) throw new Error("消息不属于当前房间");
    return message;
  }
  async importPersona(executor: string) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const files: Record<string, string> = {
      codex: path.join(home, ".codex", "AGENTS.md"),
      dsh: path.join(home, ".dsh", "AGENTS.md"),
      claude: path.join(home, ".claude", "CLAUDE.md"),
    };
    const file = files[executor];
    if (!file) throw new Error("这个执行端没有可导入的桌面端人设");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      throw new Error(`没有找到桌面端的人设文件：${file}`);
    }
    return {
      path: file,
      text: text.slice(0, 8000),
      truncated: text.length > 8000,
    };
  }
  launchDiscussion(flow: () => Promise<void>) {
    if (this.host.roomRunning || this.host.roomChanging)
      throw new Error("聊天室仍在整理，请稍后继续");
    this.host.roomStopping = false;
    this.setRoomState({ active: true, mode: "discuss" });
    const task = Promise.resolve()
      .then(flow)
      .catch((error) => {
        const d = this.host.roomStore.roomState().discussion;
        if (d)
          this.setRoomState({
            discussion: {
              ...d,
              phase: "blocked",
              reason: (error as Error).message,
            },
          });
      })
      .finally(() => {
        this.host.roomRunning = undefined;
        if (!this.host.closed) {
          this.setRoomState({ active: false, speaking: undefined });
          this.host.discussion.wake();
        }
      });
    this.host.roomRunning = task;
    this.host.flowTasks.add(task);
    void task.then(() => this.host.flowTasks.delete(task));
  }
  async ensureLounge() {
    const roomId = this.host.roomId,
      name =
        roomId === "global"
          ? "茶歇室"
          : roomId.startsWith("project:")
            ? `${this.host.require<Project>("projects", roomId.slice(8)).name} · 项目会议室`
            : roomId.startsWith("report:")
              ? "项目个人汇报"
              : "工位话题整理";
    const existing = this.host.store
      .list<Project>("projects")
      .find(
        (project) =>
          project.kind === "lounge" && (project.roomId ?? "global") === roomId,
      );
    if (existing) {
      const project = { ...existing, roomId, name };
      this.host.store.put("projects", project.id, project);
      return project;
    }
    const id =
      roomId === "global"
        ? "lounge"
        : `room-lounge-${createHash("sha256").update(roomId).digest("hex").slice(0, 24)}`;
    const directory = path.join(
      this.host.store.dataDirectory,
      roomId === "global" ? "lounge" : path.join("lounges", id),
    );
    await mkdir(directory, { recursive: true });
    const project: Project = {
      id,
      name,
      directory,
      createdAt: now(),
      collaborationPaused: false,
      kind: "lounge",
      roomId,
    };
    this.host.store.put("projects", project.id, project);
    return project;
  }
  roomSessions(includeRetired = false) {
    return this.host.store.list<Session>("sessions").filter((session) => {
      const project = this.host.store.get<Project>("projects", session.projectId);
      return (
        (includeRetired || !session.roomRetiredAt) &&
        project?.kind === "lounge" &&
        (session.roomId ?? project.roomId ?? "global") === this.host.roomId
      );
    });
  }
  async loungeSession(
    member: MemberProfile,
    purpose?: "room-hand" | "room-image" | "room-minutes" | "room-mention",
    boundThreadId?:string,
    forceLimited=false,
  ) {
    const project = await this.ensureLounge();
    const threadId = boundThreadId??this.host.roomStore.currentRoomThread().id;
    const capabilityMode:LoungeCapabilityMode=loungeDeskEnabled(this.host.roomId,this.host.roomStore.roomState().capabilityMode,purpose,forceLimited)?'desk':'limited';
    if(boundThreadId)this.host.store.roomThread(boundThreadId,this.host.roomId);
    const existing = this.roomSessions().find(
      (session) =>
        (session.roomThreadId ?? threadId) === threadId &&
        session.purpose === purpose &&
        (session.loungeCapabilityMode??'limited')===capabilityMode &&
        session.provider === member.executor &&
        (session.memberId ?? session.provider) === member.id,
    );
    if (existing) {
      if (purpose && existing.nativeId) {
        const fresh = {
          ...existing,
          nativeId: undefined,
          nativeHome: undefined,
        };
        this.host.store.put("sessions", existing.id, fresh);
        return fresh;
      }
      const session = {
        ...existing,
        loungeCapabilityMode:capabilityMode,
        writeMode:capabilityMode==='desk',
        autoApprove:capabilityMode==='desk'&&this.host.settings.defaultAutoApprove,
        ...(capabilityMode==='desk'?{workspace:project.directory,workspaceKind:'original' as const}:{}),
        roomId: this.host.roomId,
        roomThreadId: threadId,
      };
      this.host.store.put("sessions", session.id, session);
      return session;
    }
    const created = await this.host.createSession(
      project.id,
      member.executor,
      `${purpose === "room-mention" ? "点名回复" : purpose === "room-image" ? "绘图" : purpose === "room-minutes" ? "会议纪要" : purpose ? "举手" : "聊天室"} · ${member.name}`,
      capabilityMode==='desk',
      member.id,
    );
    const session = {
      ...created,
      purpose,
      loungeCapabilityMode:capabilityMode,
      ...(capabilityMode==='desk'?{workspace:project.directory,workspaceKind:'original' as const}:{}),
      roomId: this.host.roomId,
      roomThreadId: threadId,
    };
    this.host.store.put("sessions", session.id, session);
    return session;
  }
  roomMessage(message: RoomMessage) {
    const generatedImages = message.runId
      ? this.host.store.get<Run>("runs", message.runId)?.generatedImages
      : message.generatedImages;
    const stored = {
      ...message,
      ...(generatedImages ? { generatedImages } : {}),
      threadId: message.threadId ?? this.host.roomStore.currentRoomThread().id,
      authorName:
        message.authorName ??
        (message.author === "user"
          ? this.host.store.profile().name
          : message.author === "system"
            ? "系统"
            : this.host.store
                .members()
                .find((member) => member.id === message.author)?.name),
    };
    this.host.roomStore.put("room_messages", stored.id, stored);
    this.host.broadcast();
    return stored;
  }
  setRoomState(change: Partial<RoomState>) {
    this.host.roomStore.put("room", "state", {
      ...this.host.roomStore.roomState(),
      ...change,
    });
    this.host.broadcast();
  }
  async setRoomCapabilities(params:any){
    if(this.host.roomId!=='global')throw Error('能力开关仅用于茶歇室');
    const mode=params?.mode;
    if(mode!=='limited'&&mode!=='desk')throw Error('请选择受限或工位能力');
    const state=this.host.roomStore.roomState();
    if((state.capabilityMode??'limited')===mode)return {mode};
    const sessions=this.roomSessions(),ids=new Set(sessions.map(s=>s.id));
    if(this.host.roomChanging||this.host.roomStopping||this.host.roomRunning||state.active||state.compressing||state.generatingImage||this.host.store.list<Run>('runs').some(r=>ids.has(r.sessionId)&&['queued','running','waiting_user','stopping'].includes(r.status)))throw Error('请先暂停讨论并等待当前发言结束，再切换能力');
    this.host.roomChanging=true;
    try{
      // Retain visible history, but do not carry a native tool configuration across modes.
      for(const session of sessions.filter(s=>!s.purpose||s.purpose==='room-mention')){
        this.host.store.put('sessions',session.id,{...session,roomRetiredAt:now()});
        await this.host.roomRuntimes.closeSession(session.id);
      }
      this.setRoomState({capabilityMode:mode});
      return {mode};
    }finally{this.host.roomChanging=false;}
  }
  roomSend(params: any) {
    if(this.host.roomStopping)throw Error('正在终止本轮发言，请等停止完成后再发送');
    if (this.host.roomChanging) throw new Error("聊天室正在整理话题，请稍后发送");
    if (this.host.roomStore.roomState().generatingImage)
      throw new Error("图片正在生成，请先等待完成或停止。");
    if (params.mode !== "discuss")
      throw new Error("聊天室已更新，请刷新界面后重新发送。");
    const attachments = resolveAttachments(
      this.host.store.dataDirectory,
      params.attachments,
    ).map(withoutPath);
    return this.host.discussion.input({
      ...params,
      materialContext: false,
      text:
        String(params.text ?? "").trim() ||
        (attachments.length ? "请看附件。" : ""),
      attachments,
    });
  }
  roomGenerateImage(params: any) {
    const state = this.host.roomStore.roomState(),
      d = state.discussion;
    if (
      this.host.roomRunning ||
      this.host.roomChanging ||
      state.active ||
      state.compressing
    )
      throw new Error("请先暂停讨论并等待当前发言结束，再生成图片。");
    if (d?.unknownRunId || d?.unknownRunIds?.length)
      throw new Error("上次讨论结果还待核对，请先核对并结束或继续讨论。");
    const text = String(params.text ?? "").trim();
    if (!text || text.length > 20000)
      throw new Error("请写下 1–20000 字的图片描述。");
    const member = this.host.store
      .members()
      .find(
        (member) =>
          member.id === String(params.memberId ?? "") &&
          member.executor === "codex",
      );
    if (!member) throw new Error("请选择使用 Codex 的绘图成员。");
    const provider = this.host.providerRegistry.providers.find((info) => info.id === "codex");
    if (!provider?.available || provider.auth !== "subscription")
      throw new Error("请先连接并登录 Codex。");
    if (provider.capabilities.imageGeneration !== true)
      throw new Error(
        "当前 Codex 版本尚未确认支持绘图，请使用 HiveLab 合屋 已验证的新版 Codex 并重新检测。",
      );
    if (!memberPermissions(this.host.settings,member).network)
      throw new Error("图片生成需要 Codex 的联网权限，请先在设置里开启。");
    const attachments = resolveAttachments(
      this.host.store.dataDirectory,
      params.attachments,
    ).map(withoutPath);
    if (
      attachments.some(
        (file) => file.kind !== "image" || file.size > IMAGE_SEND_MAX,
      )
    )
      throw new Error("绘图参考只支持 5 MB 以内的图片。");
    const imageSession = this.roomSessions().find(
      (session) =>
        session.purpose === "room-image" &&
        (session.memberId ?? session.provider) === member.id,
    );
    const uncertain = imageSession
      ? this.host.store
          .list<Run>("runs")
          .filter(
            (run) =>
              run.sessionId === imageSession.id &&
              (run.status === "unknown" || run.delivery === "unknown") &&
              !run.imageGenerationAcknowledgedAt,
          )
      : [];
    if (uncertain.length && params.acknowledgeUnknown !== true)
      throw new Error(
        "上次图片请求的结果未知，请核对后明确确认再发送新请求；不会重发原请求。",
      );
    for (const run of uncertain)
      this.host.persistRun(run, { imageGenerationAcknowledgedAt: now() });
    if (!this.host.roomStore.roomMessages(1).length) {
      const thread = this.host.roomStore.currentRoomThread();
      this.host.roomStore.put("room_threads", thread.id, {
        ...thread,
        title: text.replace(/\s+/g, " ").slice(0, 64),
      });
    }
    const asked = this.roomMessage({
      id: randomUUID(),
      author: "user",
      text,
      at: now(),
      status: "done",
      imageGeneration: true,
      ...(attachments.length ? { attachments } : {}),
    });
    const message = this.roomMessage({
      id: randomUUID(),
      threadId: asked.threadId,
      author: member.id,
      text: "",
      at: now(),
      status: "speaking",
      imageGeneration: true,
      replyTo: asked.id,
    });
    this.host.roomStopping = false;
    this.setRoomState({
      active: true,
      mode: "chat",
      generatingImage: true,
      speaking: member.id,
    });
    const task = Promise.resolve()
      .then(async () => {
        const session = await this.loungeSession(member, "room-image",asked.threadId);
        if (this.host.roomStopping || !this.host.alive) {
          this.roomMessage({ ...message, status: "stopped" });
          return;
        }
        const references = resolveAttachments(
          this.host.store.dataDirectory,
          attachments,
        );
        const prompt = `[HiveLab 合屋 图片请求]\n这次用户明确要求生成或修改一张图片。使用原生 image_gen.imagegen 图片生成工具完成。不要用字符画、SVG 或代码替代图片，不要转用 API 密钥。若有本轮参考图片，按用户要求用于修改或参考。只生成一张；失败或限流就结束，不自行重试。不要执行命令、查阅其他文件或修改项目文件，图片会由 HiveLab 合屋 自动接收保存。成功后用一句简短的话说明结果即可。\n\n[用户描述]\n${text}${references.length ? `\n\n${describeAttachments(references, { images: true, paths: false })}` : ""}`;
        const sent = (await this.host.send(
          session.id,
          prompt,
          "message",
          undefined,
          attachments,
          true,
        )) as { runId: string };
        this.host.persistRun(this.host.require<Run>("runs", sent.runId), {
          origin: { threadId: asked.threadId, messageId: asked.id },
        });
        this.roomMessage({ ...message, runId: sent.runId });
        const result = await this.host.waitForReply(sent.runId, session.id),
          run = this.host.require<Run>("runs", sent.runId);
        const images = run.generatedImages ?? [];
        const errors = this.host.store
          .runEvents(run.id)
          .filter((event) => event.runId === run.id && event.kind === "error");
        this.roomMessage({
          ...message,
          runId: run.id,
          ...result,
          ...(result.status === "done" && !images.length
            ? {
                status: "failed" as const,
                error:
                  errors.at(-1)?.text ??
                  "Codex 本轮没有返回图片，请查看活动记录。",
              }
            : {}),
          ...(images.length && result.text === "（没有说话）"
            ? { text: "图片已生成。" }
            : {}),
        });
      })
      .catch((error) => {
        this.roomMessage({
          ...(this.host.roomStore.get<RoomMessage>("room_messages", message.id) ??
            message),
          status: this.host.roomStopping ? "stopped" : "failed",
          error: (error as Error).message,
        });
      })
      .finally(() => {
        this.host.roomRunning = undefined;
        if (!this.host.closed)
          this.setRoomState({
            active: false,
            mode: state.mode,
            generatingImage: undefined,
            speaking: undefined,
          });
      });
    this.host.roomRunning = task;
    this.host.flowTasks.add(task);
    void task.then(() => this.host.flowTasks.delete(task));
    return { accepted: true, messageId: message.id };
  }
  roomAttachments(member: MemberProfile, messages: RoomMessage[]) {
    return this.host.attachments.room(member, messages);
  }
  roomReact(messageId: string, emoji: string) {
    if (!ROOM_REACTIONS.some((item) => item.emoji === emoji))
      throw new Error("不支持这个表情");
    const message = this.host.roomStore.get<RoomMessage>("room_messages", messageId);
    if (
      !message ||
      (message.threadId ?? "room-main") !==
        this.host.roomStore.currentRoomThread().id
    )
      throw new Error("只能回应当前话题里的消息");
    if (
      message.author === "user" ||
      message.system ||
      message.status === "speaking" ||
      message.status === "passed"
    )
      throw new Error("这条消息不能添加表情");
    const reactions = toggleReaction(message.reactions, emoji, "user");
    this.host.roomStore.put("room_messages", message.id, { ...message, reactions });
    this.host.broadcast();
    return { reactions: reactions ?? {} };
  }
  pausePendingHands() {
    for (const session of this.roomSessions().filter(
      (s) => s.purpose === "room-hand",
    ))
      this.host.withdrawQueued(session.id, "讨论已暂停或内容更新，排队举手已撤回");
  }
  async cancelHands() {
    this.pausePendingHands();
    const sessions = new Set(
      this.roomSessions()
        .filter((s) => s.purpose === "room-hand")
        .map((s) => s.id),
    );
    await Promise.all(
      [...this.host.active.entries()]
        .filter(([, active]) => sessions.has(active.ctx.session.id))
        .map(([id]) => this.host.stopRun(id)),
    );
  }
  async roomHandoff(params: any) {
    const project = this.host.require<Project>(
      "projects",
      String(params.projectId ?? ""),
    );
    if (project.kind === "lounge") throw new Error("请选择一个工作项目");
    if (this.host.roomId !== "global" && this.host.roomId !== `project:${project.id}`)
      throw new Error("只能把会议室任务交给当前项目");
    const text = String(params.text ?? "").trim();
    if (!text) throw new Error("请写下要交给项目的任务");
    if (text.length > 20000) throw new Error("任务太长了，请精简后再交");
    const thread = this.roomThread(
      String(params.threadId ?? this.host.roomStore.currentRoomThread().id),
    );
    let session: Session;
    if (params.sessionId) {
      session = this.host.require<Session>("sessions", String(params.sessionId));
      if (session.projectId !== project.id)
        throw new Error("所选会话不属于这个项目");
    } else {
      const member = this.host.store
        .members()
        .find((item) => item.id === String(params.memberId ?? ""));
      if (!member) throw new Error("请选择一位成员");
      session = this.host.createSession(
        project.id,
        member.executor,
        undefined,
        typeof params.writeMode === "boolean"
          ? params.writeMode
          : this.host.settings.defaultWriteMode,
        member.id,
      );
    }
    const sent = (await this.host.send(session.id, text)) as { runId?: string };
    if (!sent?.runId) throw new Error("任务没有发出，请在项目会话里查看");
    const run = this.host.require<Run>("runs", sent.runId);
    this.host.store.put("runs", run.id, {
      ...run,
      origin: {
        threadId: thread.id,
        ...(params.messageId ? { messageId: String(params.messageId) } : {}),
      },
    });
    const member = this.host.memberFor(session),
      line = text.replace(/\s+/g, " ").slice(0, 60);
    this.roomMessage({
      id: randomUUID(),
      author: "system",
      threadId: thread.id,
      text: `已交给 ${member.name}（项目「${project.name}」）：${line}${text.length > 60 ? "…" : ""}`,
      at: now(),
      system: true,
      link: { projectId: project.id, sessionId: session.id, runId: run.id },
    });
    return { projectId: project.id, sessionId: session.id, runId: run.id };
  }
  reportHandoff(runId: string) {
    const run = this.host.store.get<Run>("runs", runId);
    if (!run?.origin?.threadId || !run.completedAt) return;
    if (run.imageGeneration) return; // The room already contains this image and its outcome, rather than a project task note.
    if (!this.host.store.get<RoomThread>("room_threads", run.origin.threadId))
      return;
    const session = this.host.store.get<Session>("sessions", run.sessionId),
      project = this.host.store.get<Project>("projects", run.projectId);
    if (!session || !project) return;
    const name = this.host.memberFor(session).name,
      review = run.origin.reviewOf,
      ok = run.status === "ended" || run.status === "completed";
    const reviewed =
        review && this.host.store.get<Session>("sessions", review.sessionId),
      author = reviewed ? this.host.memberFor(reviewed).name : "成员";
    const outcome = ok
      ? review
        ? `复核完了 ${author} 的结果，结论在下面`
        : "完成了交给 TA 的任务，结果待你验收"
      : run.status === "stopped"
        ? `的${review ? "复核" : "任务"}已停止`
        : run.status === "unknown"
          ? `的${review ? "复核" : "任务"}结果待核对`
          : `没能完成${review ? "复核" : "任务"}：${run.error ?? RUN_STATUS_TEXT[run.status] ?? run.status}`;
    const detail = ok ? this.runAnswer(run, 4000) : "";
    const threadId = run.origin.threadId,
      roomId =
        this.host.store.get<RoomThread>("room_threads", threadId)!.roomId ??
        "global";
    this.host.rooms.run(roomId, () =>
      this.roomMessage({
        id: randomUUID(),
        author: "system",
        threadId,
        text: `${name} 在项目「${project.name}」${outcome}。`,
        at: now(),
        system: true,
        ...(detail ? { detail } : {}),
        link: {
          projectId: project.id,
          sessionId: session.id,
          runId: run.id,
          outcome: run.status,
          ...(review ? { reviewOf: review } : {}),
        },
      }),
    );
  }
  runAnswer(run: Run, limit: number) {
    const parts: string[] = [];
    let streaming = false;
    for (const event of this.host.store
      .runEvents(run.id)
      .filter((item) => item.runId === run.id)) {
      const said =
        ["delta", "message"].includes(event.kind) && !(event.data as any)?.role;
      if (said && event.kind === "delta" && streaming)
        parts[parts.length - 1] += event.text;
      else if (said) parts.push(event.text);
      streaming = said && event.kind === "delta";
    }
    const text = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
    return text.length > limit ? "…" + text.slice(-limit) : text;
  }
  async reviewRun(params: any) {
    const run = this.host.require<Run>("runs", String(params.runId ?? ""));
    if (
      run.workspaceUndo?.status === "undone" ||
      run.workspaceUndo?.status === "capturing"
    )
      throw new Error(
        "本轮文件改动已撤销或还原点尚未完成，请在新的任务轮次结束后复核。",
      );
    if (!["ended", "completed"].includes(run.status))
      throw new Error("这一轮还没有顺利结束，结束后再请人复核");
    const session = this.host.require<Session>("sessions", run.sessionId),
      project = this.host.require<Project>("projects", run.projectId);
    if (session.flowId)
      throw new Error("项目任务复核由负责人管理，请在项目会议室操作");
    if (this.host.roomId !== "global" && this.host.roomId !== `project:${project.id}`)
      throw new Error("不能在其他项目会议室复核这个结果");
    this.host.assertSessionUsable(session);
    if (project.kind === "lounge") throw new Error("聊天室里的发言不需要复核");
    const author = this.host.memberFor(session),
      reviewer = this.host.store
        .members()
        .find((item) => item.id === String(params.memberId ?? ""));
    if (!reviewer) throw new Error("请选择一位复核成员");
    if (reviewer.id === author.id) throw new Error("请另选一位成员复核");
    const copied = Boolean(
      session.workspace &&
        session.workspaceKind &&
        session.workspaceKind !== "original",
    );
    let changes = "",
      fingerprint: string | undefined;
    if (copied) {
      try {
        changes = (await diffWorkspace(session.workspace!)).text.trim();
      } catch (error) {
        changes = `（没能读取改动：${(error as Error).message}）`;
      }
    }
    // The review vouches for the files as they are now; later edits make it stale.
    if (copied) {
      try {
        fingerprint = await workspaceFingerprint(session.workspace!);
      } catch {
        /* Without a version the review runs but cannot later prove it is current. */
      }
    }
    const focus = String(params.focus ?? "")
        .trim()
        .slice(0, 4000),
      answer = this.runAnswer(run, 20000);
    const prompt = [
      `[复核请求]`,
      `请以只读方式复核 ${author.name} 在项目「${project.name}」完成的一轮任务。只检查和报告，不修改任何文件。`,
      copied
        ? `你的工作目录就是 ${author.name} 的工作副本，里面是 TA 改过的文件，可以直接打开核对。`
        : `这一轮${session.writeMode ? "没有留下工作副本" : "在只读会话中完成"}，你的工作目录是项目本身。`,
      ...(focus ? [`用户希望重点看：${focus}`] : []),
      `\n## 原任务\n${run.input.slice(0, 8000)}`,
      `\n## ${author.name} 的回答\n${answer || "（没有记录到正文）"}`,
      ...(copied
        ? [
            `\n## 文件改动\n${!changes ? "（工作副本和开始时相比没有改动）" : changes.length > 40000 ? `${changes.slice(0, 40000)}\n…（改动较多，其余请直接在工作目录里查看）` : changes}`,
          ]
        : []),
      `\n## 请这样回复\n分成三部分：**已核实**（你实际查看或运行过的依据）、**需实测**（需要运行程序或由人确认的部分）、**建议**（可选的改进）。没核对过的内容放进需实测，不要当成结论。最后单独一行写总体结论：「可以通过」或「需要修改」。`,
    ].join("\n");
    const given = params.threadId
      ? this.host.roomStore.get<RoomThread>("room_threads", String(params.threadId))
      : undefined;
    const thread =
      given ??
      (run.origin?.threadId
        ? this.host.roomStore.get<RoomThread>("room_threads", run.origin.threadId)
        : undefined);
    const created = this.host.createSession(
      project.id,
      reviewer.executor,
      `复核 · ${author.name}`,
      false,
      reviewer.id,
    );
    // 'original' keeps the reviewer from applying or discarding the copy it reads.
    if (copied)
      this.host.store.put("sessions", created.id, {
        ...this.host.require<Session>("sessions", created.id),
        workspace: session.workspace,
        workspaceKind: "original",
      });
    const sent = (await this.host.send(created.id, prompt)) as { runId?: string };
    if (!sent?.runId) throw new Error("复核请求没有发出，请在项目会话里查看");
    const started = this.host.require<Run>("runs", sent.runId);
    this.host.store.put("runs", started.id, {
      ...started,
      origin: {
        ...(thread ? { threadId: thread.id } : {}),
        ...(params.messageId ? { messageId: String(params.messageId) } : {}),
        reviewOf: {
          sessionId: session.id,
          runId: run.id,
          ...(fingerprint ? { fingerprint } : {}),
        },
      },
    });
    if (thread)
      this.roomMessage({
        id: randomUUID(),
        author: "system",
        threadId: thread.id,
        text: `已请 ${reviewer.name} 复核 ${author.name} 在项目「${project.name}」的结果。`,
        at: now(),
        system: true,
        link: {
          projectId: project.id,
          sessionId: created.id,
          runId: started.id,
        },
      });
    this.host.broadcast();
    return { projectId: project.id, sessionId: created.id, runId: started.id };
  }
  async markStaleReviews(sessionId: string) {
    const session = this.host.store.get<Session>("sessions", sessionId);
    if (
      !session?.workspace ||
      !session.workspaceKind ||
      session.workspaceKind === "original"
    )
      return;
    const pending = this.host.store
      .list<RoomMessage>("room_messages")
      .filter(
        (message) =>
          message.link?.reviewOf?.sessionId === sessionId &&
          message.link.reviewOf.fingerprint &&
          !message.link.verdict &&
          !message.link.reviewStale,
      );
    if (!pending.length) return;
    let current: string;
    try {
      current = await workspaceFingerprint(session.workspace);
    } catch {
      return;
    }
    const at = now();
    let changed = false;
    for (const message of pending) {
      const latest = this.host.store.get<RoomMessage>("room_messages", message.id);
      if (
        latest?.link?.reviewOf?.fingerprint &&
        !latest.link.verdict &&
        !latest.link.reviewStale &&
        latest.link.reviewOf.fingerprint !== current
      ) {
        this.host.store.put("room_messages", latest.id, {
          ...latest,
          link: { ...latest.link, reviewStale: at },
        });
        changed = true;
      }
    }
    if (changed) this.host.broadcast();
  }
  async runVerdict(params: any) {
    const message = this.roomMessageRecord(String(params.messageId ?? ""));
    const link = message.link;
    if (!link?.runId || !link.outcome)
      throw new Error("这条消息没有可以验收的结果");
    if (link.verdict)
      throw new Error(
        link.verdict === "accepted" ? "已经验收通过了" : "已经打回修改了",
      );
    const target = link.reviewOf ?? {
      sessionId: link.sessionId,
      runId: link.runId,
    };
    const run = this.host.require<Run>("runs", target.runId),
      note = String(params.note ?? "")
        .trim()
        .slice(0, 20000);
    this.host.assertSessionUsable(this.host.require<Session>("sessions", run.sessionId));
    let result: unknown = { accepted: true };
    if (params.verdict === "accepted") {
      if (
        run.workspaceUndo?.status === "undone" ||
        run.workspaceUndo?.status === "capturing" ||
        link.undoneAt
      )
        throw new Error(
          "这一轮的文件改动已撤销或还原点尚未完成，不能验收通过。",
        );
      // Accepting on the strength of a review requires the files to be the ones the reviewer saw.
      if (link.reviewOf) {
        const authorSession = this.host.require<Session>(
            "sessions",
            link.reviewOf.sessionId,
          ),
          name = this.host.memberFor(authorSession).name;
        const stale = `复核之后 ${name} 的文件又改过，这份复核已经过期。请重新请人复核，或在 ${name} 的任务结果上直接验收。`;
        if (link.reviewStale) throw new Error(stale);
        if (link.reviewOf.fingerprint && authorSession.workspace) {
          let current: string | undefined;
          try {
            current = await workspaceFingerprint(authorSession.workspace);
          } catch {}
          if (current !== link.reviewOf.fingerprint) {
            this.host.roomStore.put("room_messages", message.id, {
              ...message,
              link: { ...link, reviewStale: now() },
            });
            this.host.broadcast();
            throw new Error(stale);
          }
        }
      }
      if (run.status === "ended")
        this.host.persistRun(run, {
          status: "completed",
          validation:
            note ||
            (link.reviewOf ? "复核后在聊天室验收通过" : "在聊天室验收通过"),
        });
      else if (run.status !== "completed")
        throw new Error("这一轮没有顺利结束，不能验收通过");
    } else if (params.verdict === "returned") {
      const instruction =
        note ||
        (link.reviewOf && message.detail
          ? "用户选择按以下已保存的复核意见修改，未补充意见：\n\n" +
            message.detail
          : "用户选择打回修改，未补充意见。请按原任务要求复查本轮成果，修正未满足的要求。");
      result = await this.roomHandoff({
        projectId: link.projectId,
        sessionId: target.sessionId,
        text: `验收没有通过，请根据下面的意见修改：\n\n${instruction}`,
        threadId: message.threadId,
        messageId: message.id,
      });
    } else throw new Error("未知的验收结果");
    // The task's own outcome note and its reviews' notes share the decision.
    const verdict = params.verdict as "accepted" | "returned",
      at = now();
    for (const item of this.host.roomStore.allRoomMessages(
      message.threadId ?? this.host.roomStore.currentRoomThread().id,
    ))
      if (
        item.link?.outcome &&
        !item.link.verdict &&
        (item.id === message.id ||
          (item.link.reviewOf?.runId ?? item.link.runId) === target.runId)
      )
        this.host.roomStore.put("room_messages", item.id, {
          ...item,
          link: { ...item.link, verdict, verdictAt: at },
        });
    this.host.broadcast();
    return result;
  }
  roomStop(preserveMinutesRequest = false,endDiscussion=false):Promise<{stopping:boolean}> {
    const room=this.host.rooms.get();
    if(endDiscussion)room.endDiscussionOnStop=true;
    if(room.stopTask)return room.stopTask;
    const discussionId=room.store.roomState().discussion?.id;
    room.stopping=true;
    const task=(async()=>{
    if (
      this.host.roomId === "global" &&
      (this.host.automationSpeaker.lifeRunning ||
        [...this.host.active.values()].some((active) => active.ctx.run.automatic) ||
        this.host.store
          .list<Run>("runs")
          .some((run) => run.automatic && run.status === "queued"))
    )
      this.host.automation.pause();
    this.host.discussion.pause(
      "你已停止讨论，核对进展后可继续。",
      preserveMinutesRequest,
    );
    this.host.roomStopping = true;
    const sessions = new Set(this.roomSessions().map((session) => session.id));
    // A project task can occupy every execution slot; withdraw room runs before stopping active ones.
    for (const sessionId of sessions)
      this.host.withdrawQueued(sessionId, "你已停止聊天室，排队中的发言已取消");
    await Promise.all(
      [...this.host.active.entries()]
        .filter(([, active]) => sessions.has(active.ctx.session.id))
        .map(([id]) => this.host.stopRun(id)),
    );
    await Promise.all(
      [...sessions].map((id) => this.host.roomRuntimes.closeSession(id)),
    );
    if(room.endDiscussionOnStop){
      await room.running;
      this.host.discussion.terminateByUser(discussionId);
    }
    return { stopping: true };

    })();
    room.stopTask=task;
    void task.finally(()=>{if(room.stopTask===task){room.stopTask=undefined;room.stopping=false;room.endDiscussionOnStop=undefined;}}).catch(()=>{});
    return task;
  }
  async changeRoom<T>(action: () => Promise<T>) {
    if (this.host.roomRunning || this.host.roomChanging || this.host.roomStopping)
      throw new Error("聊天室仍在发言或整理话题，请先停止并等待结束");
    this.host.roomChanging = true;
    try {
      return await action();
    } finally {
      this.host.roomChanging = false;
    }
  }
  async resetRoomSessions(
    options: { preserveHistory?: boolean; threadId?: string } = {},
  ) {
    const sessions = this.roomSessions(
      options.preserveHistory === false,
    ).filter(
      (session) =>
        !options.threadId ||
        (session.roomThreadId ?? this.host.roomStore.currentRoomThread().id) ===
          options.threadId,
    );
    for (const session of sessions) this.host.requireIdle(session.id, "整理话题");
    for (const session of sessions) {
      if (options.preserveHistory === false)
        await this.host.deleteSession(session.id, false, { broadcast: false });
      else {
        await this.host.roomRuntimes.closeSession(session.id);
        this.host.store.put("sessions", session.id, {
          ...session,
          roomThreadId:
            session.roomThreadId ?? this.host.roomStore.currentRoomThread().id,
          roomRetiredAt: now(),
          archived: true,
        });
      }
    }
  }
  roomClear() {
    return this.changeRoom(async () => {
      const thread = this.host.roomStore.currentRoomThread();
      await this.resetRoomSessions({
        preserveHistory: false,
        threadId: thread.id,
      });
      const attached = this.host.roomStore
        .allRoomMessages(thread.id)
        .flatMap((message) => [
          ...(message.attachments ?? []),
          ...(message.generatedImages ?? []),
        ])
        .map((item) => item.id);
      this.host.roomStore.clearRoomThread(thread.id);
      this.releaseAttachments(attached);
      // The title came from the first message; an emptied topic goes back to the neutral name.
      // Its summary described the erased messages, so it goes too; an inherited summary stays until dropped on its own.
      const { summary: _erased, ...kept } = thread;
      this.host.roomStore.put("room_threads", thread.id, {
        ...kept,
        title: "当前话题",
      });
      this.setRoomState({
        active: false,
        mode: "chat",
        topic: undefined,
        speaking: undefined,
        discussion: undefined,
      });
      return { cleared: true };
    });
  }
  roomUninherit(threadId: string) {
    return this.changeRoom(async () => {
      const thread = this.roomThread(threadId);
      if (thread.id !== this.host.roomStore.currentRoomThread().id)
        throw new Error("只能修改当前话题");
      if (!thread.inherited) return thread;
      await this.resetRoomSessions();
      const { inherited: _dropped, ...next } = thread;
      this.host.roomStore.put("room_threads", thread.id, next);
      this.host.broadcast();
      return next;
    });
  }
  roomArchive(
    title: unknown,
    inherit: boolean,
    memberId: unknown,
    from?: string,
  ) {
    return this.changeRoom(async () => {
      if (this.host.roomId !== "global")
        throw new Error("项目会议室使用固定话题，无需归档");
      const current = this.host.roomStore.currentRoomThread(),
        hasMessages = this.host.roomStore.roomMessages(1).length > 0;
      const source = from ? this.roomThread(from) : current;
      const name =
        typeof title === "string" && title.trim()
          ? title.trim().replace(/\s+/g, " ").slice(0, 64)
          : undefined;
      if (!hasMessages && !inherit)
        throw new Error("当前话题没有消息，无需归档");
      let inherited: RoomThread["inherited"];
      if (inherit) {
        const summary = this.summaryCurrent(source)
          ? source.summary!
          : await this.compressThread(source.id, memberId);
        inherited = {
          threadId: source.id,
          title: source.id === current.id && name ? name : source.title,
          text: summary.text,
        };
      }
      await this.resetRoomSessions();
      let next: RoomThread;
      if (hasMessages) next = this.host.roomStore.archiveRoom(name, inherited);
      else {
        next = { ...current, inherited };
        this.host.roomStore.put("room_threads", current.id, next);
      }
      this.setRoomState({
        active: false,
        mode: "chat",
        topic: undefined,
        speaking: undefined,
        discussion: undefined,
      });
      this.host.broadcast();
      return next;
    });
  }
  roomCompress(threadId: string, memberId: unknown) {
    return this.changeRoom(async () => {
      const summary = await this.compressThread(threadId, memberId, true);
      if (threadId === this.host.roomStore.currentRoomThread().id) {
        await this.resetRoomSessions();
        if (this.host.roomStore.roomState().mode === "discuss")
          this.host.discussion.rebase();
        this.roomMessage({
          id: randomUUID(),
          author: "system",
          text: `以上内容已由 ${summary.byName ?? "成员"} 压缩成摘要；接下来大家从摘要继续。`,
          at: now(),
          system: true,
        });
      }
      this.host.broadcast();
      return summary;
    });
  }
  roomRename(threadId: string, title: unknown) {
    const thread = this.roomThread(threadId);
    const name =
      typeof title === "string"
        ? title.trim().replace(/\s+/g, " ").slice(0, 64)
        : "";
    if (!name) throw new Error("话题名称不能为空");
    this.host.roomStore.put("room_threads", thread.id, { ...thread, title: name, autoTitle: false });
    this.host.broadcast();
    return { title: name };
  }
  lastRoomMessage(threadId: string) {
    return this.host.roomStore
      .allRoomMessages(threadId)
      .filter((item) => item.status !== "speaking" && !item.system)
      .at(-1);
  }
  summaryCurrent(thread: RoomThread) {
    return Boolean(
      thread.summary &&
        thread.summary.upTo === this.lastRoomMessage(thread.id)?.id,
    );
  }
  acceptMemories(params: any) {
    const thread = this.roomThread(String(params.threadId ?? "")),
      summary = thread.summary,
      proposed = summary?.proposals ?? [];
    if (!summary || !proposed.length)
      throw new Error("这个话题没有待确认的记忆提议");
    const given: string[] = Array.isArray(params.texts)
      ? params.texts.map((text: unknown) => String(text))
      : [];
    const texts = [...new Set(given)].filter((text) => proposed.includes(text));
    const members = this.host.store
      .members()
      .filter(
        (member) =>
          Array.isArray(params.memberIds) &&
          params.memberIds.includes(member.id),
      );
    if (!texts.length || !members.length)
      throw new Error("请选择要记住的内容和成员");
    const at = now(),
      origin =
        `${summary.byName ?? "成员"}提议 · 话题「${thread.title}」`.slice(
          0,
          80,
        );
    // Every card is checked against the memory limit before any is written.
    const cards = members.flatMap((member) => {
      const entries = memoryEntries(member),
        known = new Set(entries.map((entry) => entry.text));
      const added = texts
        .filter((text) => !known.has(text))
        .map((text) => ({
          id: newMemoryId(),
          text,
          source: "proposed" as const,
          origin,
          createdAt: at,
        }));
      if (!added.length) return [];
      try {
        return [
          normalizeMember(
            { ...member, memories: [...entries, ...added] },
            member,
          ),
        ];
      } catch (error) {
        throw new Error(`${member.name}：${(error as Error).message}`);
      }
    });
    for (const card of cards) this.host.store.put("members", card.id, card);
    const { proposals: _handled, ...rest } = summary;
    this.host.roomStore.put("room_threads", thread.id, { ...thread, summary: rest });
    this.host.broadcast();
    return { members: cards.length, items: texts.length };
  }
  async compressThread(
    threadId: string,
    memberId: unknown,
    force = false,
  ): Promise<RoomSummary> {
    const thread = this.roomThread(threadId);
    if (!force && this.summaryCurrent(thread)) return thread.summary!;
    const team = this.host.store.members(),
      member = team.find((item) => item.id === memberId) ?? team[0];
    const all = this.host.roomStore.allRoomMessages(threadId),
      cut = thread.summary?.upTo
        ? all.findIndex((item) => item.id === thread.summary!.upTo)
        : -1;
    const spoken = all
      .slice(cut + 1)
      .filter(
        (item) =>
          !item.system &&
          item.status !== "speaking" &&
          item.status !== "passed" &&
          item.text.trim(),
      );
    if (!spoken.length && thread.summary && !force) return thread.summary;
    if (!spoken.length && !thread.summary && !thread.inherited)
      throw new Error("这个话题还没有可以压缩的内容");
    const profile = this.host.store.profile(),
      userName = profile.name && profile.name !== "你" ? profile.name : "用户";
    const name = (item: RoomMessage) =>
      item.author === "user"
        ? userName
        : (item.authorName ??
          team.find((entry) => entry.id === item.author)?.name ??
          item.author);
    const lines = spoken.map(
      (item) =>
        `${name(item)}：${item.text}${item.reactions ? `（回应：${reactionText(item.reactions, (author) => (author === "user" ? userName : (team.find((entry) => entry.id === author)?.name ?? author)))}）` : ""}`,
    );
    let transcript = lines.join("\n\n");
    const truncated = transcript.length > 60000;
    if (truncated) transcript = transcript.slice(-60000);
    const earlier = [
      thread.inherited &&
        `它延续的上一个话题「${thread.inherited.title}」的摘要：\n${thread.inherited.text}`,
      thread.summary && `本话题此前已有的摘要：\n${thread.summary.text}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const prompt = `[HiveLab 合屋 话题压缩]\n请把${this.host.roomId === "global" ? "茶歇室" : "项目会议室"}的话题「${thread.title}」压缩成一份摘要。之后成员会在全新的上下文里，只凭这份摘要继续聊。\n保留：聊过的主题、达成的结论和决定、待办与分工、${userName}的偏好和要求、尚未解决的问题、各成员的重要观点（注明是谁）。省略寒暄和重复。\n用中文分条书写，不超过 800 字。直接输出摘要，不要开场白，不要使用工具，不要读写文件。\n另外，如果记录里出现了值得长期记住的、关于${userName}本人的偏好、习惯或事实（不是一次性的事务），在摘要最后另起一行写「【可记住】」，下面每行一条，每条一句话，最多 5 条；没有就不要写这一段。${truncated ? "\n（记录很长，下面只提供了最近的部分。）" : ""}${earlier ? `\n\n${earlier}` : ""}\n\n需要压缩的新记录：\n${transcript || "（没有新消息）"}`;
    const project = await this.ensureLounge();
    const created = this.host.createSession(
      project.id,
      member.executor,
      `话题摘要 · ${thread.title}`.slice(0, 60),
      false,
      member.id,
    );
    const session = {
      ...created,
      purpose: "room-summary" as const,
      roomId: this.host.roomId,
      roomThreadId: threadId,
    };
    this.host.store.put("sessions", session.id, session);
    this.setRoomState({ compressing: member.id });
    try {
      const sent = (await this.host.send(session.id, prompt)) as { runId: string };
      const result = await this.host.waitForReply(sent.runId, session.id);
      const reply = result.text.trim(),
        marker = /^[ \t]*【可记住】[：:]?[ \t]*/m.exec(reply);
      // Memory proposals are split off the summary; they never become part of what members read.
      const text = marker ? reply.slice(0, marker.index).trim() : reply;
      const proposals = marker
        ? [
            ...new Set(
              reply
                .slice(marker.index + marker[0].length)
                .split("\n")
                .map((line) =>
                  line.replace(/^\s*(?:[-*•·]|\d+[.)、．])\s*/, "").trim(),
                )
                .filter((line) => line && line.length <= 300),
            ),
          ].slice(0, 8)
        : [];
      if (
        result.status !== "done" ||
        !text ||
        text === "（没有说话）" ||
        isRoomPass(text)
      )
        throw new Error(
          result.status === "stopped"
            ? "压缩已停止"
            : `${member.name} 没能写出摘要${result.error ? `：${result.error}` : ""}`,
        );
      const summary: RoomSummary = {
        text: text.slice(0, 8000),
        by: member.id,
        byName: member.name,
        at: now(),
        upTo: this.lastRoomMessage(threadId)?.id,
        count: (thread.summary?.count ?? 0) + spoken.length,
        ...(proposals.length ? { proposals } : {}),
      };
      this.host.roomStore.put("room_threads", thread.id, {
        ...this.roomThread(thread.id),
        summary,
      });
      return summary;
    } finally {
      // The run is marked finished before its execution clears (provider confirmation follows);
      // deleting earlier fails as busy and the leftover session then blocks archiving the topic.
      const running = [...this.host.active.values()]
        .filter((active) => active.ctx.session.id === session.id)
        .map((active) => active.completion ?? Promise.resolve());
      if (running.length)
        await Promise.race([
          Promise.allSettled(running),
          new Promise((resolve) => setTimeout(resolve, 15000)),
        ]);
      await this.host.deleteSession(session.id, false, { broadcast: false }).catch(
        () => {},
      );
      if (!this.host.closed) this.setRoomState({ compressing: undefined });
    }
  }
  releaseAttachments(ids?: Iterable<string>) {
    this.host.attachments.release(ids);
  }
  async roomDelete(threadId: string) {
    const thread = this.roomThread(threadId);
    if (
      !thread.archivedAt ||
      threadId === this.host.roomStore.currentRoomThread().id
    )
      throw new Error("当前话题请使用“清空当前话题”，不能删除");
    const sessions = this.roomSessions(true).filter(
      (session) => session.roomThreadId === threadId,
    );
    for (const session of sessions) {
      this.host.requireIdle(session.id, "删除历史话题");
      if (this.host.workspaceOperations.has(this.host.workspaceKey(session)))
        throw new Error("工作副本正在整理，请稍后删除话题。");
    }
    for (const session of sessions)
      await this.host.roomRuntimes.closeSession(session.id);
    const attached = this.host.roomStore
      .allRoomMessages(threadId)
      .flatMap((message) => [
        ...(message.attachments ?? []),
        ...(message.generatedImages ?? []),
      ])
      .map((item) => item.id);
    const removed: Run[] = [];
    this.host.roomStore.removeArchivedRoomThread(threadId, () => {
      for (const session of sessions)
        removed.push(...this.host.removeSessionRecords(session.id));
    });
    for (const session of sessions) {
      this.host.memberWorkspaces.sessionRemoved(session.id);
      await removeCheckpoint(session.id, this.host.store.dataDirectory).catch(
        () => {},
      );
    }
    this.releaseAttachments([
      ...attached,
      ...removed
        .flatMap((run) => [
          ...(run.attachments ?? []),
          ...(run.generatedImages ?? []),
        ])
        .map((item) => item.id),
    ]);
    this.host.broadcast();
    return { deleted: true };
  }
  roomExport(threadId: string) {
    const thread = this.roomThread(threadId),
      messages = this.host.roomStore.allRoomMessages(threadId),
      team = [...this.host.store.members(), ...this.host.store.historicalMembers()];
    const name = (id: string) =>
      id === "user"
        ? this.host.store.profile().name
        : id === "system"
          ? "系统"
          : (team.find((member) => member.id === id)?.name ?? id);
    return {
      title: thread.title,
      content: roomMarkdown(thread, messages, name),
      count: messages.length,
    };
  }
}
