import {type RunExecutionActive} from "./run-execution";
import { PLAN_TEXT_LIMIT } from "../shared/plan-mode";
import { contextReading, type ContextUsage } from "../shared/context-usage";
import {randomUUID} from "node:crypto";
import type {AdapterContext, Project, ProviderId, PushEvent, RoomMessage, Run, Session, TimelineEvent} from "../shared/types";
import {Store} from "./store";
import {redact} from "./security";
import {GENERATED_IMAGES_MAX, storeGeneratedImage} from "./generated-images";
import {ProjectFlowController} from "./project-flow";
import {ProviderRegistry} from "./provider-registry";

const now = () => new Date().toISOString();

export interface RunEventsHost {
  require: <T>(entity: string, id: string) => T;
  store: Store;
  broadcast: () => void;
  closed: boolean;
  projectFlow: ProjectFlowController;
  push: (event: PushEvent) => void;
  active: Map<string, RunExecutionActive>;
  providerRegistry: ProviderRegistry;
  buffers: Map<string, { ctx: AdapterContext; kind: "delta" | "reasoning" | "progress"; text: string; data?: unknown; fidelity: TimelineEvent["fidelity"]; timer: NodeJS.Timeout; }>;
}

/** RunEvents owns this domain; mutable engine state is read through live host accessors. */
export class RunEvents {
  constructor(private host:RunEventsHost) {}
  persistRun(run: Run, change: Partial<Run>) {
    const current = this.host.require<Run>("runs", run.id);
    const next = { ...current, ...change, updatedAt: now() };
    this.host.store.put("runs", run.id, next);
    this.host.broadcast();
    return next;
  }
  writeEvent(
    ctx: AdapterContext,
    kind: TimelineEvent["kind"],
    text: string,
    data?: unknown,
    fidelity: TimelineEvent["fidelity"] = "native",
  ) {
    if (this.host.closed) return;
    const event = this.host.store.appendEvent({
      id: randomUUID(),
      runId: ctx.run.id,
      sessionId: ctx.session.id,
      provider: ctx.run.provider,
      at: now(),
      kind,
      text,
      data,
      fidelity,
    });
    this.host.projectFlow?.activity(event);
    this.host.push({ type: "event", event });
  }
  emit(
    ctx: AdapterContext,
    kind: TimelineEvent["kind"],
    text: string,
    data?: unknown,
    fidelity: TimelineEvent["fidelity"] = "native",
  ) {
    if (this.host.closed) return;
    if (kind === "image") {
      const active = this.host.active.get(ctx.run.id),
        run = this.host.store.get<Run>("runs", ctx.run.id);
      const native =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {};
      // Images have the same receipt and round boundary as text, and stop never publishes a late picture.
      if (
        active?.ctx !== ctx ||
        active.stopping ||
        !run ||
        run.provider !== "codex" ||
        run.automatic ||
        run.delivery !== "confirmed" ||
        !run.nativeTurnId ||
        native.nativeTurnId !== run.nativeTurnId
      )
        return;
      if (
        this.host.store.get<Project>("projects", run.projectId)?.kind === "lounge" &&
        !run.imageGeneration
      )
        return;
      if (
        run.generatedImages?.some(
          (image) =>
            image.nativeItemId === native.nativeItemId &&
            image.nativeTurnId === run.nativeTurnId,
        )
      )
        return;
      try {
        if ((run.generatedImages?.length ?? 0) >= GENERATED_IMAGES_MAX)
          throw new Error("本轮返回的图片过多，后续图片未保存。");
        const image = redact(
          storeGeneratedImage(this.host.store.dataDirectory, native),
        );
        const generatedImages = [...(run.generatedImages ?? []), image];
        this.persistRun(ctx.run, { generatedImages });
        for (const message of this.host.store
          .list<RoomMessage>("room_messages")
          .filter(
            (message) => message.runId === run.id && !message.discussionControl,
          ))
          this.host.store.put("room_messages", message.id, {
            ...message,
            generatedImages,
          });
        active.metrics?.mark("first-output");
        this.flushRun(run.id);
        this.writeEvent(ctx, "image", "图片已生成。", image, fidelity);
        this.host.broadcast();
      } catch (error) {
        this.flushRun(run.id);
        this.writeEvent(
          ctx,
          "error",
          (error as Error).message,
          undefined,
          "derived",
        );
      }
      return;
    }
    if (
      (kind === "usage" || kind === "status") &&
      this.host.providerRegistry.rememberQuota(ctx.run.provider, data, now(), "event")
    )
      this.host.broadcast();
    if (kind === "usage") this.recordContext(ctx, data);
    if (kind === "delta" || kind === "reasoning" || kind === "progress") {
      const metadata =
        data && typeof data === "object" && !Array.isArray(data)
          ? { ...(data as Record<string, unknown>) }
          : data;
      if (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
      ) {
        delete (metadata as any).delta;
        delete (metadata as any).text;
        delete (metadata as any).thinking;
      }
      const signature = JSON.stringify(redact(metadata), (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            )
          : value,
      );
      const key = `${ctx.run.id}:${kind}:${fidelity}:${signature ?? ""}`;
      const existing = this.host.buffers.get(key);
      if (existing) {
        existing.text += text;
        return;
      }
      this.flushRun(ctx.run.id); // Preserve ordering across different native items and channels.
      const value = {
        ctx,
        kind,
        text,
        data: metadata,
        fidelity,
        timer: setTimeout(() => this.flush(key), 100),
      };
      this.host.buffers.set(key, value);
      return;
    }
    this.flushRun(ctx.run.id);
    // The latest whole task list lives on the run, so the card outlasts pruned activity events.
    const todos = kind === "plan" ? (data as { hivelabTodos?: unknown } | undefined)?.hivelabTodos : undefined;
    if (Array.isArray(todos) && this.host.store.get<Run>("runs", ctx.run.id))
      this.persistRun(ctx.run, { todos: todos as Run["todos"] });
    // A plan handed over as its own item (Codex plan mode); the review opens when the turn ends.
    const planText = kind === "plan" && ctx.run.planMode ? (data as { hivelabPlan?: unknown } | undefined)?.hivelabPlan : undefined;
    if (typeof planText === "string" && planText.trim() && this.host.store.get<Run>("runs", ctx.run.id))
      this.persistRun(ctx.run, { planProposal: { status: "drafting", text: planText.slice(0, PLAN_TEXT_LIMIT), at: new Date().toISOString() } });
    this.writeEvent(ctx, kind, text, data, fidelity);
  }
  /** The topic's latest context reading. Rooms and subagents keep none: many members or a one-off conversation. */
  recordContext(ctx: AdapterContext, data: unknown) {
    if (ctx.conversation === "room" || ctx.session.id.startsWith("subagent:") || ctx.session.purpose) return;
    const reading = contextReading(ctx.run.provider, data);
    if (!reading || !reading.used) return;
    const session = this.host.store.get<Session>("sessions", ctx.session.id);
    if (!session) return;
    const old = this.host.store.get<ContextUsage>("context_usage", session.id);
    const nativeId = session.nativeId;
    // A new native conversation (a fresh topic, a reset or HiveLab compression) starts a new baseline.
    const fresh = !old || old.nativeId !== nativeId;
    const run = this.host.store.get<Run>("runs", ctx.run.id);
    const next: ContextUsage = {
      sessionId: session.id, runId: ctx.run.id, provider: ctx.run.provider, at: now(),
      used: reading.used, window: reading.window ?? (fresh ? undefined : old?.window),
      model: reading.model ?? ctx.run.effectiveConfig?.model ?? ctx.run.requestedConfig?.model ?? (fresh ? undefined : old?.model),
      ...(fresh ? { baseline: reading.used } : { baseline: old!.baseline, previous: old!.runId === ctx.run.id ? old!.previous : old!.used }),
      ...(nativeId ? { nativeId } : {}),
      ...(reading.input !== undefined ? { input: reading.input } : {}), ...(reading.cached !== undefined ? { cached: reading.cached } : {}), ...(reading.output !== undefined ? { output: reading.output } : {}),
      ...(run?.contextParts ? { parts: run.contextParts } : old?.parts ? { parts: old.parts } : {}),
    };
    this.host.store.put("context_usage", session.id, next);
    this.host.broadcast();
  }
  flush(key: string) {
    const value = this.host.buffers.get(key);
    if (!value) return;
    clearTimeout(value.timer);
    this.host.buffers.delete(key);
    this.writeEvent(
      value.ctx,
      value.kind,
      value.text,
      value.data,
      value.fidelity,
    );
  }
  flushRun(id: string) {
    for (const key of [...this.host.buffers.keys()])
      if (key.startsWith(`${id}:`)) this.flush(key);
  }
}
