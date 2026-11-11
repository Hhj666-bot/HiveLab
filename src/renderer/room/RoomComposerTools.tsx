import {t} from '../i18n';
import { ReplyLimitsButton } from "../reply-limits";
import { FileStack, LoaderCircle, Send, StopCircle } from "lucide-react";
import { hasMeetingRemarks, pendingDiscussionQuestion } from "../../shared/discussion";
import { AttachButton } from "../attachments";
import { MessageSkillButton } from "../message-skills";
import type { RoomController } from "./use-room-controller";
import { RoomComposerMode } from "./RoomComposerMode";
export function RoomComposerTools({ controller, roomHint }: { controller: RoomController; roomHint: string }) {
  const {
    personalLoading,
    room,
    personalSession,
    team,
    state,
    historyOnly,
    ready,
    invited,
    usable,
    mode,
    discussion,
    style,
    replyLimits,
    minutesBusy,
    minutesMembers,
    openMinutes,
    sending,
    busy,
    stopping,
    noTopic,
    messageSkills,
    composer,
    draft,
    attach,
    messages,
    named,
    compressing,
    send,
    terminateSpeech,
    name,
    snapshot,
    personal,
    surface,
  } = controller;
  return (
    <>
      <div className="composer-bottom">
        {!personal && !surface && (
          <ReplyLimitsButton
            value={replyLimits.value}
            onChange={replyLimits.set}
            members={team.members.filter((m) => invited.includes(m.id) || named.ids.includes(m.id)).map((m) => ({ id: m.id, name: m.name }))}
            disabled={sending || stopping || busy || historyOnly || !snapshot.backendReady}
          />
        )}
        <MessageSkillButton control={messageSkills} disabled={sending || busy || historyOnly || noTopic || !snapshot.backendReady} />
        <AttachButton onPick={() => void attach.pick()} busy={attach.busy} disabled={!snapshot.backendReady || !composer.ready || historyOnly} />
        {personal?.composerControls?.(room)}
        <RoomComposerMode controller={controller} />
        <span className="composer-hint" title={personal ? undefined : roomHint}>
          {personal
            ? personal.kind === "desk"
              ? state.active
                ? attach.items.length
                  ? t("带附件的补充将排到下一轮")
                  : snapshot.providers.find((p) => p.id === personalSession?.provider)?.capabilities.steer
                    ? t("可补充到当前轮，不中断工作")
                    : t("可发送补充，将排到下一轮")
                : personalSession?.planMode && !personalSession.restoredHistoryOnly
                  ? t("计划模式：先拟定计划，你批准后再动手")
                : personalSession?.restoredHistoryOnly
                  ? t("只读历史")
                  : personalSession && !personalSession.writeMode
                    ? t("只读查看当前文件夹")
                    : personalSession?.workspaceKind === "original"
                      ? t("直接读写当前文件夹")
                      : t("在任务副本中工作，应用后写回原文件夹")
              : t("只读回答；改要求请通过任务按钮确认")
            : roomHint}
          {composer.hasDraft ? t(" · 草稿已保留") : ""}
        </span>
        {!personal && (discussion && discussion.phase !== "idle" ? discussion.style !== "chat" : mode === "meeting") && (
          <button
            type="button"
            className={`button small ${discussion?.phase === "waiting_user" && !discussion.questions.some((q) => q.to === "user" && pendingDiscussionQuestion(q)) ? "primary" : "secondary"} composer-minutes`}
            aria-label={t("整理会议纪要")}
            disabled={
              !snapshot.backendReady ||
              stopping ||
              minutesBusy ||
              historyOnly ||
              !hasMeetingRemarks(discussion, messages) ||
              discussion?.phase === "summarizing" ||
              !minutesMembers.length
            }
            onClick={() => void openMinutes()}
          >
            <FileStack size={15} />
            {t("整理会议纪要")}</button>
        )}
        {((!personal && !surface) ||
          stopping ||
          surface?.active ||
          state.active ||
          compressing ||
          state.generatingImage ||
          (discussion && ["talking", "raising", "awaiting-host", "closing", "summarizing"].includes(discussion.phase))) && (
          <button
            type="button"
            className="button small stop-button"
            aria-label={!personal && !surface ? t("终止本轮发言") : t("中止当前对话")}
            disabled={
              !snapshot.backendReady ||
              stopping ||
              !(sending || surface?.active || state.active || compressing || state.generatingImage || (discussion && discussion.phase !== "idle"))
            }
            title={t("终止本房间当前及排队发言；其他工位任务不受影响")}
            onClick={() => void terminateSpeech()}
          >
            <StopCircle size={15} />
            {stopping ? t("终止中…") : !personal && !surface ? t("终止发言") : t("中止")}
          </button>
        )}
        <button
          type="button"
          className="send-button room-send"
          aria-label={
            personal ? (personal.kind === "desk" ? t("发送到工位") : t("发送到汇报")) : mode === "meeting" && !(discussion && discussion.phase !== "idle") ? t("开始会议") : t("发送到聊天室")
          }
          disabled={
            (!draft.trim() && !attach.items.length) ||
            sending ||
            stopping ||
            busy ||
            attach.busy ||
            (state.active && state.mode !== "discuss" && personal?.kind !== "desk") ||
            Boolean(compressing) ||
            (!usable.length && !discussion) ||
            !snapshot.backendReady ||
            historyOnly ||
            personalLoading ||
            noTopic ||
            !composer.ready
          }
          onClick={() => void send()}
        >
          {sending ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div>
    </>
  );
}
