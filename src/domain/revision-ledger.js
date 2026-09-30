// 修订账本：结论在 possible（可能）/ confirmed（已证实）/ withdrawn（已撤回）
// 之间调整时，只能追加带理由的新修订，旧修订不可覆盖、不可删除。

export const STATUS = Object.freeze({
  POSSIBLE: "possible",
  CONFIRMED: "confirmed",
  WITHDRAWN: "withdrawn",
});

export const STATUS_LABEL = Object.freeze({
  possible: "可能",
  confirmed: "已证实",
  withdrawn: "已撤回",
});

const ALLOWED_TRANSITIONS = Object.freeze({
  possible: new Set(["confirmed", "withdrawn"]),
  confirmed: new Set(["possible", "withdrawn"]),
  withdrawn: new Set(["possible"]), // 撤回后可凭新证据重新立为“可能”，但不能直接回到已证实
});

export class Claim {
  constructor(raw) {
    this.id = raw.id;
    this.statement = raw.statement;
    // 竞争解释并存：解释只增不改，每个修订必须标注倾向或存疑
    this.interpretations = raw.interpretations.map((it) => Object.freeze({ ...it }));
  }

  interpretation(id) {
    const found = this.interpretations.find((it) => it.id === id);
    if (!found) throw new Error(`解释不存在：${id}`);
    return found;
  }
}

export class RevisionLedger {
  constructor(claims = [], evidence) {
    this._claims = new Map(claims.map((raw) => [raw.id, new Claim(raw)]));
    this._evidence = evidence;
    this._revisions = [];
    this._listeners = [];
  }

  onChange(listener) {
    this._listeners.push(listener);
  }

  claim(id) {
    const claim = this._claims.get(id);
    if (!claim) throw new Error(`研究主张不存在：${id}`);
    return claim;
  }

  get all() {
    return [...this._revisions];
  }

  get(id) {
    const revision = this._revisions.find((r) => r.id === id);
    if (!revision) throw new Error(`修订不存在：${id}`);
    return revision;
  }

  latest(claimId) {
    const ordered = this._revisions
      .filter((r) => r.claim_id === claimId)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return ordered[ordered.length - 1];
  }

  asOf(claimId, date) {
    const ordered = this._revisions
      .filter((r) => r.claim_id === claimId && Date.parse(r.created_at) <= Date.parse(date))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return ordered[ordered.length - 1];
  }

  // 载入历史修订（种子基线），同样走校验但不触发通知
  seed(raw) {
    const revision = this._validate(raw);
    this._revisions.push(revision);
    return revision;
  }

  // 追加新修订：结论状态调整或撤回必须给出理由与证据基础
  revise(input) {
    const claimId = input.claim_id;
    const previous = this.latest(claimId);
    const version = previous ? previous.version + 1 : 1;
    const id = input.id ?? `rev-${claimId}-v${version}`;
    if (this._revisions.some((r) => r.id === id)) {
      throw new Error(`修订标识重复：${id}`);
    }
    if (!input.rationale || !input.rationale.trim()) {
      throw new Error("新修订必须附带理由");
    }
    if (previous && previous.status === input.status) {
      throw new Error(`结论已经是“${STATUS_LABEL[input.status]}”，无需同态修订`);
    }
    if (previous && !ALLOWED_TRANSITIONS[previous.status].has(input.status)) {
      throw new Error(
        `不允许从“${STATUS_LABEL[previous.status]}”直接转为“${STATUS_LABEL[input.status]}”`
      );
    }
    const revision = this._validate({
      ...input,
      id,
      claim_id: claimId,
      version,
      supersedes: previous?.id ?? null,
      origin: input.origin ?? "review",
    });
    this._revisions.push(revision);
    for (const listener of this._listeners) {
      listener(revision, previous);
    }
    return revision;
  }

  _validate(raw) {
    const claim = this.claim(raw.claim_id);
    if (!STATUS[raw.status.toUpperCase()]) throw new Error("修订状态非法");
    if (!Array.isArray(raw.basis) || raw.basis.length === 0) {
      throw new Error("修订必须列出证据基础");
    }
    for (const evidenceId of raw.basis) {
      if (!this._evidence.exists(evidenceId)) {
        throw new Error(`修订引用了不存在的证据：${evidenceId}`);
      }
    }
    if (raw.favored_interpretation) {
      claim.interpretation(raw.favored_interpretation);
    }
    if (!raw.wording?.public) throw new Error("修订必须给出对外表述");
    if (!raw.created_by) throw new Error("修订必须记录创建者");
    if (!raw.created_at) throw new Error("修订必须记录创建时间");
    return Object.freeze({
      ...raw,
      status: raw.status,
      basis: [...raw.basis],
      wording: { ...raw.wording },
    });
  }
}
