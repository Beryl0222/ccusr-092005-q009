import { EventStore } from "./store.js";

// 结论置信度：在“可能”与“已证实”之间调整，或被“撤回”。
export const Confidence = Object.freeze({
  POSSIBLE: "possible",
  CONFIRMED: "confirmed",
  RETRACTED: "retracted",
});

export const ConfidenceLabel = Object.freeze({
  possible: "可能",
  confirmed: "已证实",
  retracted: "已撤回",
});

// 证据分类：器物特征、出土背景、检测记录、文献引文，彼此分开保存。
export const EvidenceKind = Object.freeze({
  FEATURE: "feature",
  EXCAVATION: "excavation",
  TEST: "test",
  CITATION: "citation",
});

// 学术流程：常规评审需两名不同评审人批准；紧急勘误需一名批准且必须写明理由。
const WORKFLOWS = Object.freeze({
  standard: { requiredApprovals: 2, requireReason: false },
  urgent: { requiredApprovals: 1, requireReason: true },
});

const iso = (d) => new Date(d).toISOString();

function fail(message) {
  throw new Error(message);
}

export class ResearchService {
  constructor({ clock } = {}) {
    this.store = new EventStore(clock);
    this.artifacts = new Map(); // 器物
    this.evidence = new Map(); // 证据记录（特征/出土/检测/引文）
    this.claims = new Map(); // 研究主张
    this.opinions = new Map(); // 研究者观点（单独保存）
    this.interpretations = new Map(); // 竞争解释（并存）
    this.revisions = new Map(); // 结论修订版本
    this.channels = new Map(); // 传播渠道
    this.translations = new Map(); // `${revisionId}:${language}` -> 锁定译文
  }

  _when(at) {
    return at ? iso(at) : this.store.now();
  }

  // ---- 登记：器物、证据、主张、观点、竞争解释 ----

  registerArtifact({ id, period, excavatedIn, features = [] }, at) {
    if (this.artifacts.has(id)) fail(`器物已存在: ${id}`);
    this.artifacts.set(id, { id, period, excavatedIn, features: [...features] });
    this.store.record("ArtifactRegistered", { artifactId: id }, this._when(at));
  }

  recordEvidence({ id, artifactId, kind, summary, detail = "" }, at) {
    if (!this.artifacts.has(artifactId)) fail(`未知器物: ${artifactId}`);
    if (!Object.values(EvidenceKind).includes(kind)) fail(`未知证据类别: ${kind}`);
    if (this.evidence.has(id)) fail(`证据已存在: ${id}`);
    this.evidence.set(id, { id, artifactId, kind, summary, detail });
    this.store.record("EvidenceRecorded", { evidenceId: id, artifactId, kind }, this._when(at));
  }

  openClaim({ id, artifactId, subject }, at) {
    if (!this.artifacts.has(artifactId)) fail(`未知器物: ${artifactId}`);
    if (this.claims.has(id)) fail(`主张已存在: ${id}`);
    this.claims.set(id, {
      id,
      artifactId,
      subject,
      interpretations: [],
      revisions: [],
      publishedHistory: [], // 每次修订首次对外发布的时刻
    });
    this.store.record("ClaimOpened", { claimId: id, artifactId }, this._when(at));
  }

  // 研究者观点单独保存，可挂到某一竞争解释上。
  recordOpinion({ id, claimId, researcher, position, rationale = "", interpretationId = null }, at) {
    const claim = this.claims.get(claimId) ?? fail(`未知主张: ${claimId}`);
    if (interpretationId && !claim.interpretations.includes(interpretationId)) {
      fail(`解释 ${interpretationId} 不属于主张 ${claimId}`);
    }
    this.opinions.set(id, { id, claimId, researcher, position, rationale, interpretationId });
    this.store.record("OpinionRecorded", { opinionId: id, claimId, researcher }, this._when(at));
  }

  // 竞争解释并存：同一主张可有多条解释，不互相覆盖。
  proposeInterpretation({ id, claimId, author, statement }, at) {
    const claim = this.claims.get(claimId) ?? fail(`未知主张: ${claimId}`);
    if (this.interpretations.has(id)) fail(`解释已存在: ${id}`);
    this.interpretations.set(id, { id, claimId, author, statement });
    claim.interpretations.push(id);
    this.store.record("InterpretationProposed", { interpretationId: id, claimId }, this._when(at));
  }

  // ---- 修订与学术流程 ----

  // 起草新修订：结论调整或撤回都体现为带理由的新版本，旧版本不被修改。
  draftRevision(
    { id, claimId, interpretationId = null, statement, confidence, evidenceIds = [], reason = "", workflow = "standard" },
    at,
  ) {
    const claim = this.claims.get(claimId) ?? fail(`未知主张: ${claimId}`);
    if (this.revisions.has(id)) fail(`修订已存在: ${id}`);
    if (!Object.values(Confidence).includes(confidence)) fail(`未知置信度: ${confidence}`);
    const flow = WORKFLOWS[workflow] ?? fail(`未知学术流程: ${workflow}`);
    if (flow.requireReason && !reason) fail(`流程 ${workflow} 必须填写理由`);
    if (interpretationId && !claim.interpretations.includes(interpretationId)) {
      fail(`解释 ${interpretationId} 不属于主张 ${claimId}`);
    }
    for (const evId of evidenceIds) {
      if (!this.evidence.has(evId)) fail(`未知证据: ${evId}`);
    }
    const version = claim.revisions.length + 1;
    const revision = {
      id,
      claimId,
      version,
      interpretationId,
      statement,
      confidence,
      evidenceIds: [...evidenceIds],
      reason,
      workflow,
      status: "draft",
      reviews: [],
      approvedAt: null,
    };
    this.revisions.set(id, revision);
    claim.revisions.push(id);
    this.store.record("RevisionDrafted", { revisionId: id, claimId, version, confidence, workflow }, this._when(at));
    return revision;
  }

  // 并行评审：多名评审人可先后或同时提交；达到流程要求即批准。
  // 批准之后迟到的评审意见仍然记录（标记 late），作为未采纳意见保留。
  submitReview({ revisionId, reviewer, decision, comment = "" }, at) {
    const revision = this.revisions.get(revisionId) ?? fail(`未知修订: ${revisionId}`);
    if (!["approve", "reject"].includes(decision)) fail(`未知评审结论: ${decision}`);
    if (revision.reviews.some((r) => r.reviewer === reviewer)) fail(`评审人 ${reviewer} 已提交过评审`);
    const when = this._when(at);
    const late = revision.status !== "draft";
    revision.reviews.push({ reviewer, decision, comment, at: when, late });
    this.store.record("ReviewSubmitted", { revisionId, reviewer, decision, late }, when);
    const flow = WORKFLOWS[revision.workflow];
    const approvals = revision.reviews.filter((r) => r.decision === "approve" && !r.late).length;
    if (revision.status === "draft" && approvals >= flow.requiredApprovals) {
      revision.status = "approved";
      revision.approvedAt = when;
      this.store.record("RevisionApproved", { revisionId, approvals }, when);
    }
    return revision;
  }

  // 撤回 = 走紧急流程的新修订，置信度为“已撤回”，必须带理由。
  retractClaim({ id, claimId, reason, reviewer, statement }, at) {
    const revision = this.draftRevision(
      {
        id,
        claimId,
        statement: statement ?? `此前表述已撤回：${reason}`,
        confidence: Confidence.RETRACTED,
        reason,
        workflow: "urgent",
      },
      at,
    );
    this.submitReview({ revisionId: id, reviewer, decision: "approve", comment: "确认撤回" }, at);
    return revision;
  }

  // ---- 渠道、发布、同步、回执 ----

  registerChannel({ id, kind = "online", label = "" }, at) {
    if (this.channels.has(id)) fail(`渠道已存在: ${id}`);
    if (!["online", "offline"].includes(kind)) fail(`未知渠道类型: ${kind}`);
    this.channels.set(id, {
      id,
      kind,
      label,
      published: new Map(), // claimId -> 已发布、待同步生效的修订
      displayed: new Map(), // claimId -> 当前实际对外展示的修订
      displayLog: [], // 展示历史：只追加、不覆盖（旧展签永远保留）
      notifications: [],
      receipts: [],
    });
    this.store.record("ChannelRegistered", { channelId: id, kind }, this._when(at));
  }

  // 只有走完指定学术流程（status = approved）的修订才能发布到渠道；
  // 不允许把渠道回退到更早的版本。
  publishRevision({ revisionId, channelId }, at) {
    const revision = this.revisions.get(revisionId) ?? fail(`未知修订: ${revisionId}`);
    const channel = this.channels.get(channelId) ?? fail(`未知渠道: ${channelId}`);
    if (revision.status !== "approved") fail(`修订 ${revisionId} 未完成学术流程，不能发布`);
    const { claimId } = revision;
    const currentId = channel.published.get(claimId);
    if (currentId && this.revisions.get(currentId).version >= revision.version) {
      fail(`不允许把渠道 ${channelId} 回退或重复到版本 ${revision.version}`);
    }
    const when = this._when(at);
    channel.published.set(claimId, revisionId);
    const claim = this.claims.get(claimId);
    if (!claim.publishedHistory.some((p) => p.revisionId === revisionId)) {
      claim.publishedHistory.push({ revisionId, at: when });
    }
    this.store.record("RevisionPublished", { revisionId, channelId, claimId }, when);

    // 通知仍在分发旧版本的渠道。
    const displayedId = channel.displayed.get(claimId);
    if (displayedId && displayedId !== revisionId) {
      const type =
        revision.confidence === Confidence.RETRACTED
          ? "retraction"
          : revision.workflow === "urgent"
            ? "errata"
            : "update";
      channel.notifications.push({
        channelId,
        claimId,
        fromRevision: displayedId,
        toRevision: revisionId,
        type,
        reason: revision.reason,
        at: when,
      });
    }
    // 在线渠道发布即同步；离线渠道（如外借展览）等待显式同步。
    if (channel.kind === "online") this._syncClaim(channel, claimId, when, "publish");
  }

  _syncClaim(channel, claimId, when, cause) {
    const revisionId = channel.published.get(claimId);
    if (!revisionId || channel.displayed.get(claimId) === revisionId) return false;
    const revision = this.revisions.get(revisionId);
    channel.displayed.set(claimId, revisionId);
    // 快照写入展示日志：此后任何修订、撤回都不会改写这条历史。
    channel.displayLog.push({
      claimId,
      revisionId,
      version: revision.version,
      statement: revision.statement,
      confidence: revision.confidence,
      reason: revision.reason,
      at: when,
      cause,
    });
    this.store.record("ChannelSynced", { channelId: channel.id, claimId, revisionId, cause }, when);
    return true;
  }

  // 显式同步（外借展览等离线渠道），同步后缓存收敛到已发布版本。
  syncChannel(channelId, at, cause = "sync") {
    const channel = this.channels.get(channelId) ?? fail(`未知渠道: ${channelId}`);
    const when = this._when(at);
    const synced = [];
    for (const claimId of channel.published.keys()) {
      if (this._syncClaim(channel, claimId, when, cause)) synced.push(claimId);
    }
    return synced;
  }

  // 合作机构回执（可能离线迟到）：只记录，绝不修改已发布或已展示内容——
  // 确认旧版本的迟到回执不能把新内容降级。
  receiveReceipt({ channelId, revisionId, note = "" }, at) {
    const channel = this.channels.get(channelId) ?? fail(`未知渠道: ${channelId}`);
    const revision = this.revisions.get(revisionId) ?? fail(`未知修订: ${revisionId}`);
    const when = this._when(at);
    const currentPublished = channel.published.get(revision.claimId);
    const stale = currentPublished !== revisionId;
    const receipt = { channelId, revisionId, claimId: revision.claimId, stale, note, at: when };
    channel.receipts.push(receipt);
    this.store.record("ReceiptReceived", { ...receipt }, when);
    return receipt;
  }

  // 译文锁定到同一事实版本：同一修订同一语言只能锁定一次。
  lockTranslation({ id, revisionId, language, text }, at) {
    if (!this.revisions.has(revisionId)) fail(`未知修订: ${revisionId}`);
    const key = `${revisionId}:${language}`;
    if (this.translations.has(key)) fail(`修订 ${revisionId} 的 ${language} 译文已锁定，不能改写`);
    const translation = { id, revisionId, language, text };
    this.translations.set(key, translation);
    this.store.record("TranslationLocked", { translationId: id, revisionId, language }, this._when(at));
    return translation;
  }

  // ---- 查询 ----

  _latestPublished(claim, at) {
    const limit = at ? iso(at) : null;
    let best = null;
    for (const p of claim.publishedHistory) {
      if (limit && p.at > limit) continue;
      if (!best || this.revisions.get(p.revisionId).version > this.revisions.get(best.revisionId).version) {
        best = p;
      }
    }
    return best ? { revision: this.revisions.get(best.revisionId), publishedAt: best.at } : null;
  }

  // 公众查询：当前（或某历史时点的）对外表述及证据边界。
  publicStatement(claimId, { at, language } = {}) {
    const claim = this.claims.get(claimId) ?? fail(`未知主张: ${claimId}`);
    const found = this._latestPublished(claim, at);
    if (!found) return { claimId, status: "unpublished" };
    const { revision, publishedAt } = found;
    const result = {
      claimId,
      status: "published",
      version: revision.version,
      statement: revision.statement,
      confidence: revision.confidence,
      confidenceLabel: ConfidenceLabel[revision.confidence],
      reason: revision.reason || null,
      publishedAt,
      evidenceBoundary: revision.evidenceIds.map((evId) => {
        const ev = this.evidence.get(evId);
        return { id: ev.id, kind: ev.kind, summary: ev.summary };
      }),
      competingInterpretationCount: claim.interpretations.length,
    };
    if (language) {
      const locked = this.translations.get(`${revision.id}:${language}`);
      if (locked) {
        result.translation = { language, text: locked.text, lockedTo: revision.id };
      } else {
        // 译文必须锁定同一事实版本：没有对应译文时明确缺失，绝不拿旧版本译文冒充当前表述。
        const staleFor = claim.revisions
          .map((revId) => this.translations.get(`${revId}:${language}`))
          .find(Boolean);
        result.translation = {
          language,
          text: null,
          status: "missing",
          staleAvailableFor: staleFor ? staleFor.revisionId : null,
        };
      }
    }
    return result;
  }

  // 内部查询：按历史日期还原某渠道当时展示的展陈文字、批准者和未采纳意见。
  channelDisplayAt(channelId, date) {
    const channel = this.channels.get(channelId) ?? fail(`未知渠道: ${channelId}`);
    const limit = iso(date);
    const latestByClaim = new Map();
    for (const entry of channel.displayLog) {
      if (entry.at <= limit) latestByClaim.set(entry.claimId, entry);
    }
    const displays = [...latestByClaim.values()].map((entry) => {
      const revision = this.revisions.get(entry.revisionId);
      const approvers = revision.reviews.filter((r) => r.decision === "approve").map((r) => r.reviewer);
      const rejectedReviews = revision.reviews
        .filter((r) => r.decision === "reject")
        .map((r) => ({ source: "review", reviewer: r.reviewer, comment: r.comment, at: r.at }));
      const dissentingOpinions = [...this.opinions.values()]
        .filter(
          (o) =>
            o.claimId === revision.claimId &&
            o.interpretationId &&
            o.interpretationId !== revision.interpretationId,
        )
        .map((o) => ({ source: "opinion", researcher: o.researcher, position: o.position }));
      return {
        claimId: entry.claimId,
        revisionId: entry.revisionId,
        version: entry.version,
        statement: entry.statement,
        confidence: entry.confidence,
        displayedSince: entry.at,
        approvers,
        rejectedOpinions: [...rejectedReviews, ...dissentingOpinions],
      };
    });
    return { channelId, date: limit, displays };
  }

  // 某渠道曾经展示过的全部内容（不可覆盖的历史）。
  channelHistory(channelId) {
    const channel = this.channels.get(channelId) ?? fail(`未知渠道: ${channelId}`);
    return channel.displayLog.map((entry) => ({ ...entry }));
  }

  // 渠道通知；pending 表示该渠道当前展示内容仍落后于通知目标版本。
  notificationsFor(channelId) {
    const channel = this.channels.get(channelId) ?? fail(`未知渠道: ${channelId}`);
    return channel.notifications.map((n) => ({
      ...n,
      pending: channel.displayed.get(n.claimId) !== n.toRevision,
    }));
  }

  reviewTrail(revisionId) {
    const revision = this.revisions.get(revisionId) ?? fail(`未知修订: ${revisionId}`);
    return {
      revisionId,
      status: revision.status,
      approvers: revision.reviews.filter((r) => r.decision === "approve").map((r) => r.reviewer),
      rejected: revision.reviews.filter((r) => r.decision === "reject"),
      reviews: revision.reviews.map((r) => ({ ...r })),
    };
  }

  auditLog() {
    return this.store.all();
  }
}
