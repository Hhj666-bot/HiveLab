import { importClipboardImages } from "../attachments";
import type { RoomSummary, RoomThread } from "../../shared/types";
import { Store } from "../store";
import { RoomDiscussionController } from "../room-discussion";
import type { RoomId } from "../../shared/types";
import { memoryCandidates, memorySources } from "../desktop-memory";
import { importAttachments } from "../attachments";
import { dismissAttention } from "../attention";
import { MemberWorkspaces } from "../member-workspaces";
import { Roundtables } from "../roundtable";
import type { ProviderRegistry } from "../provider-registry";
import type { RpcParams, RpcHandler } from "./registry";

export interface RoomsApiHost {
  readonly memberWorkspaces: MemberWorkspaces;
  readonly store: Store;
  readonly attention: () => import("../../shared/attention").AttentionSummary;
  readonly providerRegistry: ProviderRegistry;
  readonly approvals: Map<
    string,
    { resolve: (v: { choice: string; answers?: unknown }) => void; reject: (e: Error) => void }
  >;
  readonly broadcast: () => void;
  readonly maintenance: boolean;
  readonly roomId: RoomId;
  readonly setRoomCapabilities: (params: RpcParams) => Promise<{ mode: "limited" | "desk" }>;
  readonly roomSend: (params: RpcParams) => Promise<unknown>;
  readonly roomGenerateImage: (params: RpcParams) => { accepted: boolean; messageId: string };
  readonly roundtables: Roundtables;
  readonly roomStop: (
    preserveMinutesRequest?: boolean,
    endDiscussion?: boolean,
  ) => Promise<{ stopping: boolean }>;
  readonly roomHandoff: (
    params: RpcParams,
  ) => Promise<{ projectId: string; sessionId: string; runId: string }>;
  readonly discussion: RoomDiscussionController;
  readonly roomStore: Store;
  readonly roomRunning: Promise<void> | undefined;
  readonly roomStopping: boolean;
  readonly roomReact: (
    messageId: string,
    emoji: string,
  ) => { reactions: { [x: string]: string[] } };
  readonly roomClear: () => Promise<{ cleared: boolean }>;
  readonly roomUninherit: (threadId: string) => Promise<{
    id: string;
    title: string;
    createdAt: string;
    archivedAt?: string;
    autoTitle?: boolean;
    roomId?: RoomId;
    projectId?: string;
    summary?: RoomSummary;
    count?: number;
    lastMessageAt?: string;
  }>;
  readonly acceptMemories: (params: RpcParams) => { members: number; items: number };
  readonly roomThread: (id: string) => RoomThread;
  readonly roomArchive: (
    title: unknown,
    inherit: boolean,
    memberId: unknown,
    from?: string,
  ) => Promise<RoomThread>;
  readonly roomCompress: (threadId: string, memberId: unknown) => Promise<RoomSummary>;
  readonly roomRename: (threadId: string, title: unknown) => { title: string };
  readonly roomDelete: (threadId: string) => Promise<{ deleted: boolean }>;
  readonly roomExport: (threadId: string) => { title: string; content: string; count: number };
}

const bounded = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(Math.floor(number), max)) : fallback;
};

export function createRoomsApi(host: RoomsApiHost) {
  return {
    "desk.open": async (params: RpcParams): Promise<unknown> => {
      const roomId: RoomId = `desk:${String(params.memberId)}`;
      return host.memberWorkspaces.get(
        host.store.get("personal_rooms", roomId)
          ? roomId
          : host.memberWorkspaces.ensureMember(String(params.memberId)),
      );
    },
    "desk.folder": async (params: RpcParams): Promise<unknown> => {
      host.memberWorkspaces.ensureMember(String(params.memberId));
      return {
        directory: host.memberWorkspaces.folder(String(params.memberId)),
      };
    },
    "desk.switchFolder": async (params: RpcParams): Promise<unknown> => {
      return host.memberWorkspaces.switchFolder(String(params.memberId), params);
    },
    "desk.topic": async (params: RpcParams): Promise<unknown> => {
      return host.memberWorkspaces.newTopic(
        host.memberWorkspaces.ensureMember(String(params.memberId)),
        params,
      );
    },
    "report.open": async (params: RpcParams): Promise<unknown> => {
      return host.memberWorkspaces.get(
        host.memberWorkspaces.ensureReport(String(params.projectId), String(params.memberId)),
      );
    },
    "report.work": async (params: RpcParams): Promise<unknown> => {
      return host.memberWorkspaces.work(String(params.projectId), String(params.memberId));
    },
    "attention.list": async (params: RpcParams): Promise<unknown> => {
      return host.attention();
    },
    "attention.dismiss": async (params: RpcParams): Promise<unknown> => {
      const result = dismissAttention(
        host.store,
        host.providerRegistry.providers,
        new Set(host.approvals.keys()),
        params.id,
        params.fingerprint,
      );
      host.broadcast();
      return result;
    },
    "projectRoom.ensure": async (params: RpcParams): Promise<unknown> => {
      if (host.maintenance) throw new Error("正在备份或恢复资料，请等完成后再操作。");
      const thread = host.store.ensureProjectRoom(String(params.projectId));
      host.broadcast();
      return { roomId: thread.roomId, threadId: thread.id };
    },
    "room.get": async (params: RpcParams): Promise<unknown> => {
      return host.store.roomView(host.roomId);
    },
    "room.capabilities": async (params: RpcParams): Promise<unknown> => {
      return host.setRoomCapabilities(params);
    },
    "room.send": async (params: RpcParams): Promise<unknown> => {
      return host.roomSend(params);
    },
    "room.generateImage": async (params: RpcParams): Promise<unknown> => {
      return host.roomGenerateImage(params);
    },
    "room.stop": async (params: RpcParams): Promise<unknown> => {
      return host.roomId.startsWith("roundtable:")
        ? host.roundtables.interruptRoom(host.roomId)
        : host.roomStop(false, params?.endDiscussion === true);
    },
    "room.handoff": async (params: RpcParams): Promise<unknown> => {
      return host.roomHandoff(params);
    },
    "room.pause": async (params: RpcParams): Promise<unknown> => {
      return host.discussion.pause();
    },
    "room.end": async (params: RpcParams): Promise<unknown> => {
      const state = host.roomStore.roomState(),
        d = state.discussion;
      if (
        state.mode !== "discuss" ||
        !d ||
        typeof params.discussionId !== "string" ||
        params.discussionId !== d.id
      )
        throw new Error("讨论已切换，请刷新后再结束。");
      if (d.phase === "idle") return { ended: true };
      const running = host.roomRunning;
      await host.roomStop();
      await running;
      return host.discussion.finishByUser(params.acknowledgeUnknown === true, params.discussionId);
    },
    "room.resume": async (params: RpcParams): Promise<unknown> => {
      if (host.roomStopping) throw Error("正在终止本轮发言，请等待停止完成后再继续");
      return host.discussion.resume(params ?? {});
    },
    "room.minutes": async (params: RpcParams): Promise<unknown> => {
      return host.discussion.requestMinutes(params ?? {});
    },
    "room.host": async (params: RpcParams): Promise<unknown> => {
      return host.discussion.hostChoice(params ?? {});
    },
    "room.react": async (params: RpcParams): Promise<unknown> => {
      return host.roomReact(String(params.messageId ?? ""), String(params.emoji ?? ""));
    },
    "room.clear": async (params: RpcParams): Promise<unknown> => {
      return host.roomClear();
    },
    "room.uninherit": async (params: RpcParams): Promise<unknown> => {
      return host.roomUninherit(String(params.threadId ?? ""));
    },
    "memory.sources": async (params: RpcParams): Promise<unknown> => {
      return memorySources(String(params.executor ?? ""));
    },
    "memory.read": async (params: RpcParams): Promise<unknown> => {
      return memoryCandidates(String(params.executor ?? ""), String(params.source ?? ""));
    },
    "memory.accept": async (params: RpcParams): Promise<unknown> => {
      return host.acceptMemories(params);
    },
    "memory.dismiss": async (params: RpcParams): Promise<unknown> => {
      const thread = host.roomThread(String(params.threadId ?? ""));
      if (thread.summary?.proposals) {
        const { proposals: _handled, ...summary } = thread.summary;
        host.roomStore.put("room_threads", thread.id, { ...thread, summary });
        host.broadcast();
      }
      return { dismissed: true };
    },
    "room.archive": async (params: RpcParams): Promise<unknown> => {
      return host.roomArchive(
        params.title,
        Boolean(params.inherit),
        params.memberId,
        params.from == null ? undefined : String(params.from),
      );
    },
    "room.compress": async (params: RpcParams): Promise<unknown> => {
      return host.roomCompress(
        String(params.threadId ?? host.roomStore.currentRoomThread().id),
        params.memberId,
      );
    },
    "room.rename": async (params: RpcParams): Promise<unknown> => {
      return host.roomRename(String(params.threadId ?? ""), params.title);
    },
    "room.delete": async (params: RpcParams): Promise<unknown> => {
      return host.roomDelete(String(params.threadId ?? ""));
    },
    "room.history": async (params: RpcParams): Promise<unknown> => {
      return host.roomStore.roomHistory(
        String(params.threadId ?? host.roomStore.currentRoomThread().id),
        params.before == null ? undefined : String(params.before),
        bounded(params.limit, 1, 200, 100),
      );
    },
    "room.export": async (params: RpcParams): Promise<unknown> => {
      return host.roomExport(String(params.threadId ?? host.roomStore.currentRoomThread().id));
    },
    "attachment.import": async (params: RpcParams): Promise<unknown> => {
      return importAttachments(host.store.dataDirectory, params.paths);
    },
    "attachment.paste": async (params: RpcParams): Promise<unknown> => {
      return importClipboardImages(host.store.dataDirectory, params.images);
    },
  } satisfies Record<string, RpcHandler>;
}
