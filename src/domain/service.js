// 研究结论与传播校订服务（门面）。
// 装配证据分储、修订账本、评审门禁、渠道日志、通知回执与译文锁，
// 对外提供：提修订、并行评审、走完流程才发布、公众查询、内部历史还原、收敛校验。

import { EvidenceStore, EVIDENCE_KINDS } from "./evidence-store.js";
import { RevisionLedger, STATUS_LABEL } from "./revision-ledger.js";
import { ReviewOffice, STAGE_LABEL } from "./review-office.js";
import { Channel, PublicationLog, NotifyBoard } from "./publication-channel.js";
import { TranslationRegistry } from "./translation-registry.js";

export class ResearchPublicationService {
  constructor(seed, { clock } = {}) {
    this._clock = clock ?? (() => new Date());
    this.evidence = new EvidenceStore(seed.evidence ?? []);
    this.ledger = new RevisionLedger(seed.claims ?? [], this.evidence);
    this.reviewOffice = new ReviewOffice({ clock: this._clock });
    this.translations = new TranslationRegistry();
    this.notify = new NotifyBoard({ clock: this._clock });

    this.channels = new Map((seed.channels ?? []).map((raw) => [raw.id, new Channel(raw)]));
    this.logs = new Map([...this.channels.values()].map((ch) => [ch.id, new PublicationLog(ch)]));

    // 历史修订入账（不触发通知）
    for (const raw of seed.conclusions ?? []) this.ledger.seed(raw);
    // 历史展签入账（旧展签原样保留，永不覆盖）
    for (const pub of seed.publications ?? []) {
      const revision = this.ledger.get(pub.revision_id);
      this.logs.get(pub.channel_id).seed({
        kind: pub.kind ?? "publication",
        revision,
        label: pub.label,
        approver: pub.approver,
        published_at: pub.published_at,
        process_id: pub.process_id ?? null,
        reason: pub.reason ?? null,
        translations: pub.translations ?? {},
      });
    }

    // 新修订一旦产生，自动通知仍在分发旧版本的渠道
    this.ledger.onChange((revision, previous) => {
      if (previous) {
        this.notify.issue(revision, [...this.logs.values()], revision.rationale);
      }
    });

    // 经紧急流程发布、尚待常规流程补审的渠道
    this._emergencyPendingFollowup = new Set();
  }

  revise(input) {
    return this.ledger.revise({ ...input, created_at: input.created_at ?? this._clock().toISOString() });
  }

  openReview({ process_id, revision_id, channel_id, mode = "standard" }) {
    return this.reviewOffice.open({
      id: process_id,
      revision: this.ledger.get(revision_id),
      channel: this.channels.get(channel_id),
      mode,
    });
  }

  // 发布门禁：只有走完渠道指定学术流程的版本才能发布；译文必须锁定同一事实版本
  publish({ revision_id, channel_id, process_id, approver, label, langs = [], kind }) {
    const revision = this.ledger.get(revision_id);
    const channel = this.channels.get(channel_id);
    const log = this.logs.get(channel_id);
    if (!channel) throw new Error(`渠道不存在：${channel_id}`);
    // 迟到的流程/回执只能用于同步最新版本，禁止把渠道钉在或拉回旧修订
    if (this.ledger.latest(revision.claim_id).id !== revision.id) {
      throw new Error(`${revision.id} 已被更新修订取代，禁止发布到任何渠道`);
    }
    const process = this.reviewOffice.get(process_id);
    if (process.revision_id !== revision.id) throw new Error("流程与修订不匹配");
    if (process.isRejected()) throw new Error("该流程已被否决，不能发布");
    if (!process.isComplete()) {
      throw new Error(
        `流程尚未走完，待完成：${process.required_stages
          .filter((s) => !process.approvals().some((a) => a.stage === s))
          .map((s) => STAGE_LABEL[s] ?? s)
          .join("、")}`
      );
    }
    const requiredStages = process.mode === "emergency" ? channel.emergency_stages : channel.required_stages;
    if (process.required_stages.join("|") !== requiredStages.join("|")) {
      throw new Error("流程环节与渠道要求不符");
    }
    const translations = langs.length ? this.translations.lockedTranslations(revision, langs) : {};
    const entryKind = kind ?? (process.mode === "emergency" ? "erratum" : "publication");
    const entry = log.append({
      kind: entryKind,
      revision,
      label: label ?? revision.wording.public,
      approver,
      at: this._clock().toISOString(),
      process_id,
      reason: process.mode === "emergency" ? revision.rationale : null,
      translations,
    });
    this.notify.markEffective(channel_id, revision.id);
    if (process.mode === "emergency") this._emergencyPendingFollowup.add(`${channel_id}@${revision.id}`);
    return entry;
  }

  // 紧急勘误完成后补走常规流程：补齐后解除待补审标记
  completeStandardFollowup(revision_id, channel_id, process_id) {
    const process = this.reviewOffice.get(process_id);
    if (process.mode !== "standard" || !process.isComplete()) {
      throw new Error("常规流程未完成，不能解除补审标记");
    }
    this._emergencyPendingFollowup.delete(`${channel_id}@${revision_id}`);
  }

  followupDue(channel_id, revision_id) {
    return this._emergencyPendingFollowup.has(`${channel_id}@${revision_id}`);
  }

  markDelivered(channel_id, revision_id) {
    return this.notify.markDelivered(channel_id, revision_id);
  }

  // 迟到回执：仅登记；版本落后时标 late_ignored，渠道当前版本不受任何影响
  recordLateReceipt(channel_id, payload) {
    const currentVersion = this.logs.get(channel_id).current()?.version ?? null;
    return this.notify.recordReceipt(channel_id, payload, currentVersion);
  }

  // 公众查询：当前表述 + 证据边界（五类证据分别列示）+ 竞争解释
  publicQuery(claimId) {
    const claim = this.ledger.claim(claimId);
    const revision = this.ledger.latest(claimId);
    const grouped = this.evidence.groupedByIds(revision.basis);
    const boundary = Object.fromEntries(
      Object.entries(grouped)
        .filter(([, rows]) => rows.length > 0)
        .map(([kind, rows]) => [
          EVIDENCE_KINDS[kind],
          rows.map((r) => ({ id: r.id, summary: r.summary })),
        ])
    );
    return {
      主张: claim.statement,
      当前结论: STATUS_LABEL[revision.status],
      当前表述: revision.wording.public,
      结论版本: revision.version,
      生效时间: revision.created_at,
      证据边界: boundary,
      竞争解释: claim.interpretations.map((it) => ({
        解释: it.label,
        内容: it.summary,
        本版倾向: revision.favored_interpretation === it.id,
      })),
      各渠道当前表述: [...this.logs.values()].map((log) => ({
        渠道: log.channel.name,
        版本: log.current()?.version ?? null,
        展签文字: log.current()?.label ?? null,
      })),
    };
  }

  // 内部人员按历史日期还原：当天各渠道展陈文字、批准者，以及未采纳意见
  internalAsOf(claimId, date) {
    const revision = this.ledger.asOf(claimId, date);
    return {
      查询日期: date,
      当时最新修订: revision ? { id: revision.id, 版本: revision.version, 状态: STATUS_LABEL[revision.status] } : null,
      渠道: [...this.logs.values()].map((log) => {
        const entry = log.asOf(date);
        let processes = entry ? this.reviewOffice.forRevision(entry.revision_id) : [];
        if (entry?.process_id) {
          const byId = processes.find((p) => p.id === entry.process_id);
          processes = byId ? [byId] : [];
        } else {
          processes = processes.filter((p) => p.channel_id === log.channel.id);
        }
        const reviews = processes.flatMap((p) =>
          p.reviews().map((r) => ({
            评审人: r.reviewer,
            意见: r.comment,
            立场: r.vote === "support" ? "支持" : "异议（未采纳）",
            是否采纳: r.considered,
            收到时间: r.received_at,
          }))
        );
        return {
          渠道: log.channel.name,
          当天展签: entry?.label ?? null,
          对应版本: entry?.version ?? null,
          类型: entry ? (entry.kind === "erratum" ? "紧急勘误" : "常规发布") : null,
          批准者: entry?.approver ?? null,
          发布时间: entry?.published_at ?? null,
          评审与未采纳意见: reviews,
        };
      }),
    };
  }

  // 缓存收敛校验：每个渠道当前是否已在分发该主张的最新修订
  convergence(claimId) {
    const latest = this.ledger.latest(claimId);
    const rows = [...this.logs.values()].map((log) => {
      const current = log.current();
      const note = this.notify
        .forChannel(log.channel.id)
        .find((n) => n.revision_id === latest.id);
      return {
        渠道: log.channel.name,
        当前版本: current?.version ?? null,
        目标版本: latest.version,
        已收敛: current?.revision_id === latest.id,
        通知状态: current?.revision_id === latest.id ? "effective" : note?.state ?? "未通知",
        待补常规流程: this.followupDue(log.channel.id, latest.id),
      };
    });
    return { 最新修订: latest.id, 全部收敛: rows.every((r) => r.已收敛), 各渠道: rows };
  }

  channelHistory(channelId) {
    return this.logs.get(channelId).history();
  }
}
