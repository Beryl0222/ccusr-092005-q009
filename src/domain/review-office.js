// 学术流程门禁：修订只有走完渠道指定的流程，才能发布到该渠道。
// 常规评审：同行评审 → 编辑委员会 / 策展委员会；支持多条评审并行。
// 紧急勘误：走渠道的 emergency_stages（如值班馆长），并强制后补常规流程。
// 竞争解释下，未采纳的评审意见同样归档，供内部历史还原。

export const STAGE_LABEL = Object.freeze({
  peer_review: "同行评审",
  editorial_board: "教材编辑委员会",
  curatorial_committee: "策展委员会",
  duty_curator_approval: "值班馆长紧急批准",
  host_confirmation: "合作机构确认",
});

export class ReviewProcess {
  constructor({ id, revision_id, channel_id, mode = "standard", required_stages = [], clock = () => new Date() }) {
    this.id = id;
    this.revision_id = revision_id;
    this.channel_id = channel_id;
    this.mode = mode; // standard | emergency
    this.required_stages = [...required_stages];
    this._clock = clock;
    // 并行评审票：每条意见独立记录（含未采纳意见）
    this._reviews = new Map();
    this._approvals = new Map(required_stages.map((stage) => [stage, null]));
    this._rejected = false;
  }

  // 并行提交评审意见；review 形如 { reviewer, interpretation_id, vote, comment }
  submitReview(review) {
    if (!review?.reviewer) throw new Error("评审意见必须署名");
    if (!["support", "dissent"].includes(review.vote)) {
      throw new Error("评审意见需标明 support（采纳倾向）或 dissent（未采纳）");
    }
    const key = review.reviewer;
    if (this._reviews.has(key)) throw new Error(`评审人已提交意见：${key}`);
    const stored = Object.freeze({
      ...review,
      received_at: this._clock().toISOString(),
      considered: false,
    });
    this._reviews.set(key, stored);
    return stored;
  }

  reviews() {
    return [...this._reviews.values()];
  }

  dissentingReviews() {
    return this.reviews().filter((r) => r.vote === "dissent");
  }

  // 流程负责人在决定推进时标注哪些意见被采纳；未标注即视为未采纳并保留
  markConsidered(reviewerNames) {
    for (const name of reviewerNames) {
      const review = this._reviews.get(name);
      if (!review) throw new Error(`找不到评审意见：${name}`);
      this._reviews.set(name, Object.freeze({ ...review, considered: true }));
    }
  }

  approve(stage, approver, note = "") {
    if (!this._approvals.has(stage)) throw new Error(`本流程不包含环节：${stage}`);
    this._approvals.set(stage, Object.freeze({
      stage,
      approver,
      note,
      at: this._clock().toISOString(),
    }));
  }

  reject(approver, reason) {
    this._rejected = true;
    this._rejection = Object.freeze({ approver, reason, at: this._clock().toISOString() });
  }

  isComplete() {
    if (this._rejected) return false;
    return this.required_stages.every((stage) => this._approvals.get(stage) !== null);
  }

  isRejected() {
    return this._rejected;
  }

  approvals() {
    return [...this._approvals.values()].filter(Boolean);
  }

  rejection() {
    return this._rejection ?? null;
  }

  snapshot() {
    return {
      id: this.id,
      revision_id: this.revision_id,
      mode: this.mode,
      required_stages: [...this.required_stages],
      reviews: this.reviews(),
      approvals: this.approvals(),
      rejected: this._rejected,
      rejection: this.rejection(),
      complete: this.isComplete(),
    };
  }
}

export class ReviewOffice {
  constructor({ clock } = {}) {
    this._clock = clock ?? (() => new Date());
    this._processes = new Map();
  }

  open({ id, revision, channel, mode = "standard" }) {
    const stages = mode === "emergency" ? channel.emergency_stages : channel.required_stages;
    if (!stages?.length) throw new Error(`渠道 ${channel.id} 未配置${mode === "emergency" ? "紧急" : "常规"}流程`);
    const process = new ReviewProcess({
      id,
      revision_id: revision.id,
      channel_id: channel.id,
      mode,
      required_stages: stages,
      clock: this._clock,
    });
    this._processes.set(id, process);
    return process;
  }

  get(id) {
    const process = this._processes.get(id);
    if (!process) throw new Error(`评审流程不存在：${id}`);
    return process;
  }

  forRevision(revisionId) {
    return [...this._processes.values()].filter((p) => p.revision_id === revisionId);
  }
}
