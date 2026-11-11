import { createHash } from "node:crypto";
import type {
  MemberQuota,
  MemberProfile,
  ProviderId,
  ProviderInfo,
  RoomMessage,
  RoomState,
  Run,
  Session,
  Settings,
} from "../shared/types";
import { quotaPreference } from "../shared/quota";
import { Store } from "./store";
import { AutomationScheduler, type TimedResult } from "./automation-scheduler";
import type { AutomaticOrigin, TimedJob, TimedOccurrence } from "../shared/automation";
import { localParts } from "../shared/automation";
import { AutomaticBudget, AutomaticDenied } from "./automatic-budget";
import { DailyLife, memberChatPrompt, openingPrompt, rotateMembers } from "./daily-life";
import type { EngineTiming } from "./engine-options";

export interface AutomationSpeakerHost {
  readonly timing: EngineTiming | undefined;
  roomRunning: Promise<void> | undefined;
  readonly roomChanging: boolean;
  readonly closed: boolean;
  readonly setRoomState: (change: Partial<RoomState>) => void;
  readonly flowTasks: Set<Promise<void>>;
  readonly send: (
    sessionId: string,
    text: string,
    intent?: "message" | "supplement" | "redirect",
    automatic?: AutomaticOrigin,
  ) => Promise<unknown>;
  readonly roomMessage: (message: RoomMessage) => RoomMessage;
  readonly waitForReply: (
    runId: string,
    sessionId: string,
  ) => Promise<Pick<RoomMessage, "text" | "status" | "error">>;
  readonly store: Store;
  readonly providerChecks: Map<string, Promise<ProviderInfo>>;
  readonly roomStore: Store;
  readonly alive: boolean;
  readonly dailyLife: DailyLife;
  readonly automation: AutomationScheduler;
  readonly automaticBudget: AutomaticBudget;
  readonly providers: ProviderInfo[];
  readonly settings: Settings;
  readonly memberQuota: (provider: ProviderId) => MemberQuota | undefined;
  roomStopping: boolean;
  readonly automaticAllowed: (
    origin: AutomaticOrigin,
    provider: ProviderId,
    model?: string,
  ) => void;
  readonly loungeSession: (
    member: MemberProfile,
    purpose?: "room-hand" | "room-image" | "room-minutes" | "room-mention",
    boundThreadId?: string,
    forceLimited?: boolean,
  ) => Promise<Session>;
}

const now = () => new Date().toISOString();
const ROOM_BUSY_SKIP = "聊天室还在讨论、已被你暂停或有结果待核对，本次自动发言已跳过。";

/** Owns automation speaker state and lifecycle. */
export class AutomationSpeaker {
  constructor(private host: AutomationSpeakerHost) {}

  lifeRunning = false;

  automationNow() {
    return this.host.timing?.automationNow?.() ?? Date.now();
  }

  lifeMemberStamp(member?: MemberProfile) {
    return member ? createHash("sha256").update(JSON.stringify(member)).digest("hex") : undefined;
  }

  roomBusyForAutomation(previous: RoomState) {
    return Boolean(
      this.host.roomRunning ||
        this.host.roomChanging ||
        previous.active ||
        (previous.discussion && previous.discussion.phase !== "idle"),
    );
  }

  holdRoomFor(task: Promise<unknown>, previous: RoomState, life = false) {
    const lifecycle = task
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        if (this.host.roomRunning === lifecycle) {
          this.host.roomRunning = undefined;
          if (life) this.lifeRunning = false;
          if (!this.host.closed)
            this.host.setRoomState({
              ...previous,
              active: false,
              speaking: undefined,
            });
        }
        this.host.flowTasks.delete(lifecycle);
      });
    this.host.roomRunning = lifecycle;
    this.host.flowTasks.add(lifecycle);
  }

  async speakAutomatically(params: {
    member: MemberProfile;
    sessionId: string;
    prompt: string;
    origin: AutomaticOrigin;
    messageId: string;
    threadId: string;
    afterSend?: () => void;
  }): Promise<{ outcome: TimedResult; run?: Run; text?: string }> {
    let runId: string | undefined;
    try {
      const sent = (await this.host.send(
        params.sessionId,
        params.prompt,
        "message",
        params.origin,
      )) as { runId: string };
      runId = sent.runId;
      params.afterSend?.();
      const message: RoomMessage = {
        id: params.messageId,
        author: params.member.id,
        authorName: params.member.name,
        threadId: params.threadId,
        runId,
        text: "",
        at: now(),
        status: "speaking",
        automatic: params.origin,
      };
      this.host.roomMessage(message);
      const reply = await this.host.waitForReply(runId, params.sessionId),
        run = this.host.store.get<Run>("runs", runId)!;
      const unknown = run.status === "unknown" || run.delivery === "unknown";
      this.host.roomMessage({
        ...message,
        ...reply,
        ...(unknown
          ? {
              text: "",
              status: "failed" as const,
              error: "本次自动发言结果待核对，未自动重发。",
            }
          : {}),
        automatic: run.automatic,
      });
      return {
        run,
        text: reply.text,
        outcome: {
          status: unknown
            ? "unknown"
            : reply.status === "done"
              ? "done"
              : run.delivery === "withdrawn" || reply.status === "stopped"
                ? "skipped"
                : "failed",
          reason: reply.error || run.error,
          runId,
        },
      };
    } catch (error) {
      return {
        outcome: {
          status: error instanceof AutomaticDenied ? "skipped" : "failed",
          reason: (error as Error).message,
          runId,
        },
      };
    }
  }

  async lifeSpeech(job: TimedJob, item: TimedOccurrence): Promise<TimedResult> {
    if (!job.managed || job.action.kind !== job.managed)
      return { status: "skipped", reason: "内置自动任务来源无效。" };
    // The first window can appear before startup account checks finish. Wait for those read-only checks.
    await Promise.allSettled([...this.host.providerChecks.values()]);
    const previous = this.host.roomStore.roomState(),
      feature = job.managed;
    if (!this.host.alive || !this.host.dailyLife.visible || !this.host.automation.current(item))
      return { status: "skipped", reason: "窗口已隐藏或自动功能已暂停。" };
    if (this.roomBusyForAutomation(previous)) return { status: "skipped", reason: ROOM_BUSY_SKIP };
    const denied = this.host.automaticBudget.reason(feature);
    if (denied) return { status: "skipped", reason: denied };
    const thread = this.host.roomStore.currentRoomThread();
    if (
      thread.archivedAt ||
      (job.action.kind === "daily-opening" &&
        (job.action.threadId !== thread.id ||
          job.action.day !== localParts(this.automationNow()).day))
    )
      return {
        status: "skipped",
        reason: "话题或日期已改变，未补发每日开场。",
      };
    const ready = this.host.store
      .members()
      .filter((member) =>
        this.host.providers.some(
          (provider) => provider.id === member.executor && provider.available && !provider.stale,
        ),
      );
    const candidates = ready.filter(
      (member) =>
        !this.host.automaticBudget.reason(
          feature,
          member.executor,
          member.model || this.host.settings.models[member.executor],
        ) &&
        !this.host.store
          .list<Session>("sessions")
          .some(
            (session) =>
              session.projectId === "lounge" &&
              session.purpose !== "room-hand" &&
              (session.memberId ?? session.provider) === member.id &&
              this.host.store.get("blocked_sessions", session.id),
          ),
    );
    if (
      ready.length &&
      ready.every(
        (member) =>
          quotaPreference(
            this.host.memberQuota(member.executor),
            Date.now(),
            member.model || this.host.settings.models[member.executor],
          ) === 0,
      )
    ) {
      this.host.automation.hold(
        job.id,
        "所有可用成员的账号额度均受限，请核对额度后恢复未来的触发。",
      );
      return {
        status: "skipped",
        reason: "全员额度受限，已暂停这类自动发言。",
      };
    }
    const order = rotateMembers(
        candidates,
        this.host.store.get<{ memberId: string }>("daily_life", feature)?.memberId,
      ),
      first = order[0];
    if (!first || (feature === "member-chat" && order.length < 2))
      return {
        status: "skipped",
        reason: "没有足够的已连接且无需核对的成员；每日开场需一位，闲聊需两位。",
      };
    const usage = this.host.automaticBudget.snapshot().find((value) => value.feature === feature)!;
    if (feature === "member-chat" && usage.limit - usage.used < 2)
      return {
        status: "skipped",
        reason: "成员闲聊需要两次调用，今日剩余预算不足。",
      };
    const other =
      order
        .slice(1)
        .find(
          (member) =>
            first.relations?.some((relation) => relation.memberId === member.id) ||
            member.relations?.some((relation) => relation.memberId === first.id),
        ) ?? order[1];
    const members = feature === "daily-opening" ? [first] : [first, other];
    const parent = {
      ...item,
      threadId: thread.id,
      memberIds: members.map((member) => member.id),
      memberStamps: members.map((member) => this.lifeMemberStamp(member)!),
    };
    this.host.store.put("timed_occurrences", item.id, parent);
    this.host.roomStopping = false;
    this.lifeRunning = true;
    this.host.setRoomState({ active: true, mode: "chat", speaking: first.id });
    const task = Promise.resolve().then(async (): Promise<TimedResult> => {
      const runIds: string[] = [];
      let replyText: string | undefined;
      for (let step = 0; step < members.length; step++) {
        const member = members[step],
          child: TimedOccurrence = {
            ...item,
            id: `${item.id}:${step}`,
            parentOccurrenceId: item.id,
            memberId: member.id,
            step,
            status: "running",
            startedAt: now(),
            threadId: thread.id,
          };
        if (this.host.store.get("timed_occurrences", child.id))
          return {
            status: "unknown",
            reason: "这次成员发言已经登记，未重复发送。",
            runIds,
          };
        this.host.store.put("timed_occurrences", child.id, child);
        const origin: AutomaticOrigin = {
          feature,
          jobId: job.id,
          occurrenceId: child.id,
        };
        let outcome: TimedResult;
        try {
          this.host.automaticAllowed(
            origin,
            member.executor,
            member.model || this.host.settings.models[member.executor],
          );
          const session = await this.host.loungeSession(member, undefined, undefined, true);
          this.host.automaticAllowed(
            origin,
            member.executor,
            member.model || this.host.settings.models[member.executor],
          );
          if (this.host.store.get("blocked_sessions", session.id))
            throw new AutomaticDenied("成员上一轮仍待核对，未开始自动发言。");
          this.host.setRoomState({ speaking: member.id });
          const prompt =
            feature === "daily-opening"
              ? openingPrompt(
                  member,
                  this.host.roomStore.roomMessages(1000, thread.id),
                  this.automationNow(),
                )
              : memberChatPrompt(
                  member,
                  members[step === 0 ? 1 : 0],
                  this.automationNow(),
                  replyText,
                );
          const spoken = await this.speakAutomatically({
            member,
            sessionId: session.id,
            prompt,
            origin,
            messageId: `automatic-${child.id}`,
            threadId: thread.id,
            afterSend:
              step === 0
                ? () =>
                    this.host.store.put("daily_life", feature, {
                      memberId: member.id,
                      at: now(),
                    })
                : undefined,
          });
          outcome = spoken.outcome;
          if (outcome.runId) runIds.push(outcome.runId);
          replyText = spoken.text;
          if (spoken.run?.status === "rate_limited")
            this.host.automation.hold(job.id, "本次成员发言受限，请核对额度后恢复未来的触发。");
        } catch (error) {
          outcome = {
            status: error instanceof AutomaticDenied ? "skipped" : "failed",
            reason: (error as Error).message,
          };
        }
        this.host.store.put("timed_occurrences", child.id, {
          ...child,
          ...outcome,
          finishedAt: now(),
        });
        if (outcome.status !== "done") return { ...outcome, runIds };
      }
      return { status: "done", runId: runIds.at(-1), runIds };
    });
    this.holdRoomFor(task, previous, true);
    return task;
  }

  async automaticSpeech(job: TimedJob, item: TimedOccurrence): Promise<TimedResult> {
    if (job.action.kind !== "member-message") return { status: "skipped" };
    const action = job.action;
    const member = this.host.store.members().find((member) => member.id === action.memberId);
    if (!member) return { status: "skipped", reason: "成员已经删除。" };
    const origin: AutomaticOrigin = {
      feature: action.feature,
      jobId: job.id,
      occurrenceId: item.id,
    };
    try {
      this.host.automaticAllowed(
        origin,
        member.executor,
        member.model || this.host.settings.models[member.executor],
      );
    } catch (error) {
      return { status: "skipped", reason: (error as Error).message };
    }
    const previous = this.host.roomStore.roomState();
    if (this.roomBusyForAutomation(previous)) return { status: "skipped", reason: ROOM_BUSY_SKIP };
    this.host.roomStopping = false;
    this.host.setRoomState({ active: true, mode: "chat", speaking: member.id });
    const task = Promise.resolve().then(async (): Promise<TimedResult> => {
      try {
        const session = await this.host.loungeSession(member, undefined, undefined, true),
          current = this.host.store.get<Session>("sessions", session.id)!;
        if (this.host.store.get("blocked_sessions", current.id))
          return {
            status: "skipped",
            reason: "成员上一轮的结果还待核对，本次自动发言已跳过。",
          };
        if (this.host.roomStopping || !this.host.alive)
          return { status: "skipped", reason: "你已停止本次发言。" };
        this.host.automaticAllowed(
          origin,
          member.executor,
          member.model || this.host.settings.models[member.executor],
        );
        const context = this.host.roomStore
          .roomMessages(8, action.threadId)
          .filter((message) => !message.system && message.status !== "speaking")
          .map(
            (message) => `${message.authorName || message.author}：${message.text.slice(0, 700)}`,
          )
          .join("\n");
        const prompt = `[HiveLab 合屋 主人已启用的定时发言]\n任务名称：${job.name}\n主人预先设置的要求：${action.text}\n这是一条定时发言，只回复一次，不继续调度其他成员。不要使用工具、读写文件或执行命令；不要声称做过没有记录的工作。\n近期聊天仅为参考：\n${context || "（暂无）"}`;
        return (
          await this.speakAutomatically({
            member,
            sessionId: session.id,
            prompt,
            origin,
            messageId: `automatic-${item.id}`,
            threadId: action.threadId,
          })
        ).outcome;
      } catch (error) {
        return {
          status: error instanceof AutomaticDenied ? "skipped" : "failed",
          reason: (error as Error).message,
        };
      }
    });
    this.holdRoomFor(task, previous);
    return task;
  }
}
