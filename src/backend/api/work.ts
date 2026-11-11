import { runtimeDiagnostics } from "../runtime-diagnostics";
import { type MessageSkill } from "../../shared/message-skills";
import { type RunExecutionActive } from "../run-execution";
import { RoundResultReader } from "../round-results";
import { normalizeConfigSelection, type RequestedRunConfig } from "../../shared/executor-config";
import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  Attachment,
  AdapterContext,
  Project,
  ProviderId,
  Run,
  Session,
  Settings,
  TimelineEvent,
} from "../../shared/types";
import { Store } from "../store";
import { redact } from "../security";
import {
  listArtifacts,
  readArtifact,
  diffWorkspace,
  applyWorkspace,
  discardWorkspace,
} from "../workspace";
import { RoomRuntimePool } from "../runtime-pool";
import { checkpointInfo, removeCheckpoint } from "../workspace-checkpoint";
import type { AutomaticOrigin } from "../../shared/automation";
import { resolveAttachments, withoutPath } from "../attachments";
import type { ProjectFlow } from "../../shared/project-flow";
import { ProjectTree } from "../project-tree";
import { assertProjectPaths, withProjectWrite } from "../project-access";
import { projectUndoInfo } from "../workspace-writeback";
import type { ProviderRegistry } from "../provider-registry";
import type { RpcParams, RpcHandler } from "./registry";

export interface WorkApiHost {
  readonly store: Store;
  readonly projectTree: ProjectTree;
  readonly broadcast: () => void;
  readonly createSession: (
    projectId: string,
    provider: ProviderId,
    title?: string,
    writeMode?: boolean,
    memberId?: string,
  ) => Session;
  readonly require: <T>(entity: string, id: string) => T;
  readonly roomRuntimes: RoomRuntimePool;
  readonly active: Map<string, RunExecutionActive>;
  readonly emit: (
    ctx: AdapterContext,
    kind: TimelineEvent["kind"],
    text: string,
    data?: unknown,
    fidelity?: TimelineEvent["fidelity"],
  ) => void;
  readonly stopRun: (runId: string) => Promise<void>;
  readonly updateSession: (sessionId: string, params: RpcParams) => Session;
  readonly deleteSession: (
    sessionId: string,
    discard: boolean,
    options?: { broadcast?: boolean; deleteFiles?: boolean },
  ) => Promise<{ deleted: boolean; workspaceRemoved: boolean }>;
  readonly projectConfiguration: (project: Project, memberId: string) => RequestedRunConfig;
  readonly removeProject: (
    projectId: string,
    discard: boolean,
  ) => Promise<{ removed: boolean; sessions: number }>;
  readonly assertSessionUsable: (session: Session) => void;
  readonly workspaceOperation: <T>(
    session: Session,
    action: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly persistRun: (run: Run, change: Partial<Run>) => unknown;
  readonly undoWorkspace: (
    sessionId: string,
    runId: string,
    partial?: boolean,
  ) => Promise<import("../workspace-checkpoint").UndoInfo>;
  readonly reviewRun: (
    params: RpcParams,
  ) => Promise<{ projectId: string; sessionId: string; runId: string }>;
  readonly runVerdict: (params: RpcParams) => Promise<unknown>;
  readonly send: (
    sessionId: string,
    text: string,
    intent?: "message" | "supplement" | "redirect",
    automatic?: AutomaticOrigin,
    attachments?: Attachment[],
    imageGeneration?: boolean,
    flowOperationId?: string,
    supplementId?: string,
    messageSkills?: MessageSkill[],
  ) => Promise<unknown>;
  readonly providerRegistry: ProviderRegistry;
  readonly settings: Settings;
  readonly steerActive: (
    runId: string,
    text: string,
    deliveryId: string,
  ) => Promise<"current" | "next-turn" | "unknown">;
  readonly stopAll: () => Promise<void>;
  readonly answer: (params: RpcParams) => { answered: boolean };
  readonly startCollaboration: (_params: RpcParams) => Promise<void>;
  readonly pauseCollaboration: (id: string) => { paused: boolean };
  readonly resumeCollaboration: (id: string) => void;
}

const now = () => new Date().toISOString();

export function createWorkApi(host: WorkApiHost) {
  return {
    "project.openPath": async (params: RpcParams): Promise<unknown> => {
      return new RoundResultReader(host.store).openPath(params);
    },
    "project.create": async (params: RpcParams): Promise<unknown> => {
      // A relative path would resolve against the app install directory, never the user's intent.
      const requested = String(params.directory || "").trim();
      if (!path.isAbsolute(requested))
        throw new Error("请填写项目文件夹的完整路径，例如 C:\\Users\\你\\Desktop\\项目");
      const directory = path.resolve(requested);
      const info = await stat(directory).catch(() => undefined);
      if (!info?.isDirectory()) throw new Error("找不到这个文件夹，请检查路径");
      const project = host.projectTree.create(directory, params);
      host.broadcast();
      return project;
    },
    "project.move": async (params: RpcParams): Promise<unknown> => {
      const project = host.projectTree.move(params);
      host.broadcast();
      return project;
    },
    "session.create": async (params: RpcParams): Promise<unknown> => {
      return host.createSession(
        String(params.projectId),
        params.provider as ProviderId,
        params.title as string | undefined,
        params.writeMode as boolean | undefined,
        params.memberId ? String(params.memberId) : undefined,
      );
    },
    "session.approvals": async (params: RpcParams): Promise<unknown> => {
      // Revoke or grant session-level auto-approval; takes effect on the next request.
      const session = host.require<Session>("sessions", String(params.sessionId));
      const next = {
        ...session,
        ...(typeof params.autoApprove === "boolean" ? { autoApprove: params.autoApprove } : {}),
        ...(params.clearRules ? { approvalRules: [] } : {}),
      };
      host.store.put("sessions", session.id, next);
      host.broadcast();
      await host.roomRuntimes.closeSession(session.id);
      // Codex's `never` policy is fixed for an active turn. Stop it when revoking automatic approval.
      const running = [...host.active.values()].find(
        (active) => active.ctx.session.id === session.id,
      );
      if (
        session.autoApprove &&
        next.autoApprove === false &&
        running &&
        session.provider === "codex" &&
        running.ctx.session.writeMode &&
        running.ctx.settings.permissions.codex.commands === "auto" &&
        running.ctx.settings.permissions.codex.fileScope === "any"
      ) {
        host.emit(
          running.ctx,
          "status",
          "已关闭会话自动批准，停止当前 Codex 轮次；下一轮按成员权限重新启动。",
          undefined,
          "derived",
        );
        await host.stopRun(running.ctx.run.id);
      }
      return next;
    },
    "session.update": async (params: RpcParams): Promise<unknown> => {
      const result = host.updateSession(String(params.sessionId), params);
      await host.roomRuntimes.closeSession(String(params.sessionId));
      return result;
    },
    "session.delete": async (params: RpcParams): Promise<unknown> => {
      return host.deleteSession(String(params.sessionId), params.discardWorkspace === true, {deleteFiles:params.deleteFiles===true});
    },
    "project.update": async (params: RpcParams): Promise<unknown> => {
      const project = host.require<Project>("projects", String(params.projectId)),
        next = { ...project };
      if (
        params.name === undefined &&
        params.memberIds === undefined &&
        params.writeWorkLogs === undefined &&
        params.memberConfigs === undefined &&
        params.projectRecordToFolder === undefined
      )
        throw new Error("请提供项目名称、参会成员名单或项目设置");
      if (params.writeWorkLogs !== undefined) {
        if (typeof params.writeWorkLogs !== "boolean") throw new Error("日志设置必须是开或关");
        next.writeWorkLogs = params.writeWorkLogs;
      }
      if (params.projectRecordToFolder !== undefined) {
        if (typeof params.projectRecordToFolder !== "boolean")
          throw new Error("记录设置必须是开或关");
        next.projectRecordToFolder = params.projectRecordToFolder;
      }
      if (params.name !== undefined) {
        const name = String(params.name ?? "").trim();
        if (!name) throw new Error("项目名称不能为空");
        next.name = name.slice(0, 120);
      }
      if (params.memberIds !== undefined) {
        const ids = params.memberIds,
          known = new Set(host.store.members().map((member) => member.id));
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !known.has(id)))
          throw new Error("参会名单必须是已存在成员的编号数组");
        next.memberIds = [...new Set<string>(ids)];
      }
      const changedMembers: string[] = [];
      if (params.memberConfigs !== undefined) {
        if (
          params.expectedConfigRevision !== undefined &&
          params.expectedConfigRevision !== (project.memberConfigRevision ?? 0)
        )
          throw new Error("项目成员配置已更新，请刷新后再保存");
        if (
          !params.memberConfigs ||
          typeof params.memberConfigs !== "object" ||
          Array.isArray(params.memberConfigs)
        )
          throw new Error("项目成员配置必须是按成员保存的对象");
        const known = new Set(host.store.members().map((member) => member.id));
        next.memberConfigs = { ...project.memberConfigs };
        for (const [memberId, value] of Object.entries(params.memberConfigs)) {
          if (!known.has(memberId)) throw new Error("配置中的成员不存在");
          const choice = value === null ? {} : normalizeConfigSelection(value);
          if (JSON.stringify(next.memberConfigs[memberId] ?? {}) !== JSON.stringify(choice))
            changedMembers.push(memberId);
          if (Object.keys(choice).length) next.memberConfigs[memberId] = choice;
          else delete next.memberConfigs[memberId];
        }
        if (changedMembers.length)
          next.memberConfigRevision = (project.memberConfigRevision ?? 0) + 1;
      }
      host.store.transaction(() => {
        host.store.put("projects", project.id, next);
        for (const flow of host.store
          .list<import("../../shared/project-flow").ProjectFlow>("project_flows")
          .filter(
            (flow) =>
              flow.projectId === project.id && !["completed", "cancelled"].includes(flow.status),
          )) {
          const relevant = changedMembers.filter((id) => flow.memberIds.includes(id));
          if (!relevant.length) continue;
          host.store.put("project_flows", flow.id, {
            ...flow,
            revision: flow.revision + 1,
            updatedAt: now(),
            memberConfigs: {
              ...flow.memberConfigs,
              ...Object.fromEntries(
                relevant.map((id) => [id, host.projectConfiguration(next, id)]),
              ),
            },
          });
        }
      });
      host.broadcast();
      return next;
    },
    "project.remove": async (params: RpcParams): Promise<unknown> => {
      return host.removeProject(String(params.projectId), params.discardWorkspaces !== false);
    },
    "workspace.apply": async (params: RpcParams): Promise<unknown> => {
      const session = host.require<Session>("sessions", String(params.sessionId));
      host.assertSessionUsable(session);
      if (!session.workspace || session.workspaceKind === "original" || !session.workspaceKind)
        throw new Error("这个会话直接在项目里工作，没有需要应用的副本");
      const project = host.require<Project>("projects", session.projectId);
      return host.workspaceOperation(session, "应用改动", () =>
        withProjectWrite(
          host.store,
          project.id,
          project.directory,
          async (check) => {
            const checkpoint = await checkpointInfo(session, host.store.dataDirectory);
            const result = await applyWorkspace(
              session.workspace!,
              project.directory,
              (paths) => {
                check();
                assertProjectPaths(host.store, project.id, paths);
              },
              checkpoint.status === "available" ? checkpoint.runId : undefined,
            );
            if (result.conflicts.length)
              host.store.put("workspace_conflicts", session.id, {
                sessionId: session.id,
                workspace: session.workspace,
                at: now(),
                conflicts: result.conflicts,
              });
            else host.store.delete("workspace_conflicts", session.id);
            host.broadcast();
            return result;
          },
          true,
        ),
      );
    },
    "workspace.discard": async (params: RpcParams): Promise<unknown> => {
      const session = host.require<Session>("sessions", String(params.sessionId));
      return host.workspaceOperation(session, "丢弃副本", async () => {
        await discardWorkspace(
          session,
          host.require<Project>("projects", session.projectId),
          host.store.dataDirectory,
        );
        await removeCheckpoint(session.id, host.store.dataDirectory).catch(() => {});
        // The next turn builds a fresh copy from the project as it is then.
        const next = {
          ...session,
          workspace: undefined,
          workspaceKind: undefined,
          updatedAt: now(),
        };
        host.store.put("sessions", session.id, next);
        host.store.delete("workspace_conflicts", session.id);
        for (const run of host.store
          .list<Run>("runs")
          .filter(
            (run) => run.sessionId === session.id && run.workspaceUndo?.status === "available",
          ))
          host.persistRun(run, {
            workspaceUndo: {
              status: "unavailable",
              reason: "工作副本已丢弃",
            },
          });
        host.broadcast();
        return next;
      });
    },
    "workspace.undo.info": async (params: RpcParams): Promise<unknown> => {
      const session = host.require<Session>("sessions", String(params.sessionId)),
        info = await checkpointInfo(session, host.store.dataDirectory);
      if (info.runId && session.workspace)
        info.projectUndo = await projectUndoInfo(
          session.workspace,
          info.runId,
          host.require<Project>("projects", session.projectId).directory,
        );
      return info;
    },
    "workspace.undo": async (params: RpcParams): Promise<unknown> => {
      return host.undoWorkspace(
        String(params.sessionId),
        String(params.runId),
        params.restoreUnchanged === true,
      );
    },
    "run.review": async (params: RpcParams): Promise<unknown> => {
      return host.reviewRun(params);
    },
    "run.verdict": async (params: RpcParams): Promise<unknown> => {
      return host.runVerdict(params);
    },
    "session.send": async (params: RpcParams): Promise<unknown> => {
      return host.send(
        String(params.sessionId),
        String(params.text || ""),
        (params.intent || "message") as "message" | "supplement" | "redirect",
        undefined,
        resolveAttachments(host.store.dataDirectory, params.attachments).map(withoutPath),
        false,
        undefined,
        undefined,
        params.messageSkills as MessageSkill[] | undefined,
      );
    },
    "session.events": async (params: RpcParams): Promise<unknown> => {
      host.require<Session>("sessions", String(params.sessionId));
      return host.store.listEvents(String(params.sessionId));
    },
    "run.activity": async (params: RpcParams): Promise<unknown> => {
      const runId = String(params.runId ?? "");
      host.require<Run>("runs", runId);
      return host.store.runActivity(
        runId,
        params.before === undefined ? undefined : String(params.before),
        Number(params.limit ?? 100),
      );
    },
    "run.diagnostics": async (params: RpcParams): Promise<unknown> => {
      const run = host.require<Run>("runs", String(params.runId ?? ""));
      return runtimeDiagnostics({
        provider: run.provider,
        info: host.providerRegistry.providers.find((p) => p.id === run.provider),
        run,
        session: host.store.get<Session>("sessions", run.sessionId),
        events: host.store.runDiagnosticEvents(run.id),
        settings: host.settings,
      });
    },
    "run.inputs": async (params: RpcParams): Promise<unknown> => {
      // The snapshot carries previews only; retry, export and the session view read the exact task here.
      const ids = Array.isArray(params.runIds) ? params.runIds.map(String).slice(0, 500) : [];
      return Object.fromEntries(
        ids.flatMap((id: string) => {
          const run = host.store.get<Run>("runs", id);
          return run ? [[id, run.input]] : [];
        }),
      );
    },
    "run.nudge": async (params: RpcParams): Promise<unknown> => {
      const runId = String(params.runId);
      host.require<Run>("runs", runId);
      // One durable receipt per attempt, including unknown delivery, prevents
      // another window or a reload from repeating this fixed request.
      const delivery = await host.steerActive(
        runId,
        "请尽快收尾这一份工作，给出已有成果，并如实说明尚未完成或未核实的部分。不要扩大任务范围，不要为了收尾虚报完成。",
        `run-nudge:${runId}`,
      );
      return { delivery };
    },
    "run.stop": async (params: RpcParams): Promise<unknown> => {
      await host.stopRun(String(params.runId));
      return { received: true };
    },
    "all.stop": async (params: RpcParams): Promise<unknown> => {
      await host.stopAll();
      return { received: true };
    },
    "approval.answer": async (params: RpcParams): Promise<unknown> => {
      return host.answer(params);
    },
    "artifact.list": async (params: RpcParams): Promise<unknown> => {
      const session = host.require<Session>("sessions", String(params.sessionId));
      if (session.restoredHistoryOnly) return [];
      const project = host.require<Project>("projects", session.projectId);
      let files = await listArtifacts(session.workspace || project.directory);
      const outputs = path.join(host.store.dataDirectory, "artifacts", session.id);
      try {
        files = [
          ...files,
          ...(await listArtifacts(outputs)).map((x) => ({
            ...x,
            relativePath: `@artifacts/${x.relativePath}`,
          })),
        ];
      } catch {}
      return files;
    },
    "artifact.read": async (params: RpcParams): Promise<unknown> => {
      const session = host.require<Session>("sessions", String(params.sessionId));
      host.assertSessionUsable(session);
      const project = host.require<Project>("projects", session.projectId);
      const output = String(params.relativePath);
      const root = output.startsWith("@artifacts/")
        ? path.join(host.store.dataDirectory, "artifacts", session.id)
        : session.workspace || project.directory;
      const result = await readArtifact(
        root,
        output.startsWith("@artifacts/") ? output.slice(11) : output,
      );
      const content = redact(result.content);
      return {
        ...result,
        content:
          content === result.content
            ? content
            : `[HiveLab 合屋：敏感凭据已脱敏；源文件未改动]\n${content}`,
      };
    },
    "project.diff": async (params: RpcParams): Promise<unknown> => {
      const session = host.require<Session>("sessions", String(params.sessionId));
      if (session.restoredHistoryOnly)
        return {
          text: "备份不包含工作副本，本会话仅保留历史；当前项目文件未被恢复。",
        };
      return diffWorkspace(
        session.workspace || host.require<Project>("projects", session.projectId).directory,
      );
    },
    "run.validate": async (params: RpcParams): Promise<unknown> => {
      const run = host.require<Run>("runs", String(params.runId));
      host.assertSessionUsable(host.require<Session>("sessions", run.sessionId));
      if (run.workspaceUndo?.status === "undone" || run.workspaceUndo?.status === "capturing")
        throw new Error("本轮文件改动已撤销或还原点尚未完成，不能验收。");
      if (!["ended", "completed"].includes(run.status))
        throw new Error("先核对当前执行状态；未结束或结果未知的任务不能直接验收完成");
      host.persistRun(run, {
        status: "completed",
        validation: String(params.validation ?? "").trim() || "用户确认验收，未补充说明。",
      });
      return { saved: true };
    },
    "collaboration.start": async (params: RpcParams): Promise<unknown> => {
      return host.startCollaboration(params);
    },
    "collaboration.pause": async (params: RpcParams): Promise<unknown> => {
      return host.pauseCollaboration(String(params.id));
    },
    "collaboration.resume": async (params: RpcParams): Promise<unknown> => {
      return host.resumeCollaboration(String(params.id));
    },
  } satisfies Record<string, RpcHandler>;
}
