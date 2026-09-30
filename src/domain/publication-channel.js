// 渠道分发。
// PublicationLog：每个渠道的展签/表述只追加、不覆盖；“当前展签”由日志末尾导出。
// NotifyBoard：新修订生成后通知所有仍在分发旧版本的渠道；支持渠道离线、延迟送达。
// 回执：迟到回执只记录送达事实，绝不回滚渠道当前版本（单调版本号护栏）。

export class Channel {
  constructor(raw) {
    this.id = raw.id;
    this.name = raw.name;
    this.required_stages = [...raw.required_stages];
    this.emergency_stages = [...(raw.emergency_stages ?? raw.required_stages)];
    Object.freeze(this);
  }
}

let entrySeq = 0;

export class PublicationLog {
  constructor(channel) {
    this.channel = channel;
    this._entries = [];
  }

  // 历史展签入账：与 append 同样的字段形状（revision 会被归一化为标识与版本），但不做门禁
  seed(entry) {
    const revision = entry.revision;
    const normalized = revision
      ? {
          ...entry,
          revision_id: revision.id,
          claim_id: revision.claim_id,
          version: revision.version,
        }
      : entry;
    const { revision: _ignored, ...rest } = normalized;
    this._entries.push(Object.freeze({ seq: (entrySeq += 1), ...rest }));
  }

  // 追加发布记录；同一修订版本重复发布或试图回退到旧版本都会被拒绝
  append({ kind = "publication", revision, label, approver, at, process_id, reason = null, translations = {} }) {
    const current = this.current();
    if (current && current.revision_id === revision.id) {
      throw new Error(`渠道 ${this.channel.id} 已在分发 ${revision.id}，禁止重复发布`);
    }
    if (current && current.version >= revision.version) {
      throw new Error(
        `渠道 ${this.channel.id} 当前为版本 ${current.version}，禁止被旧版本 ${revision.version} 降级`
      );
    }
    const entry = Object.freeze({
      seq: (entrySeq += 1),
      kind, // publication | erratum
      revision_id: revision.id,
      claim_id: revision.claim_id,
      version: revision.version,
      label,
      approver,
      process_id,
      reason,
      translations: Object.freeze({ ...translations }),
      published_at: at,
      supersedes: current?.revision_id ?? null,
    });
    this._entries.push(entry);
    return entry;
  }

  history() {
    return [...this._entries];
  }

  current() {
    return this._entries[this._entries.length - 1] ?? null;
  }

  // 内部人员按历史日期还原该渠道当天实际展示的文字
  asOf(date) {
    const t = Date.parse(date);
    const visible = this._entries
      .filter((e) => Date.parse(e.published_at) <= t)
      .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
    return visible[visible.length - 1] ?? null;
  }

  isDistributing(revisionId) {
    return this.current()?.revision_id === revisionId;
  }
}

export class NotifyBoard {
  constructor({ clock } = {}) {
    this._clock = clock ?? (() => new Date());
    this._notifications = [];
    this._receiptLog = [];
  }

  // 新修订产生：向仍在分发该主张旧版本的渠道发勘误通知
  issue(revision, channelLogs, reason) {
    const issued = [];
    for (const log of channelLogs) {
      const current = log.current();
      if (current && current.claim_id === revision.claim_id && current.revision_id !== revision.id) {
        const note = Object.freeze({
          id: `note-${revision.id}-${log.channel.id}`,
          revision_id: revision.id,
          channel_id: log.channel.id,
          from_revision_id: current.revision_id,
          reason,
          state: "pending", // pending | delivered | effective
          created_at: this._clock().toISOString(),
          delivered_at: null,
          effective_at: null,
        });
        this._notifications.push(note);
        issued.push(note);
      }
    }
    return issued;
  }

  _update(id, patch) {
    const idx = this._notifications.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`通知不存在：${id}`);
    this._notifications[idx] = Object.freeze({ ...this._notifications[idx], ...patch });
    return this._notifications[idx];
  }

  forChannel(channelId) {
    return this._notifications.filter((n) => n.channel_id === channelId);
  }

  pendingFor(channelId) {
    return this.forChannel(channelId).filter((n) => n.state === "pending");
  }

  markDelivered(channelId, revisionId) {
    const note = this.forChannel(channelId).find(
      (n) => n.revision_id === revisionId && n.state === "pending"
    );
    if (!note) return null;
    return this._update(note.id, { state: "delivered", delivered_at: this._clock().toISOString() });
  }

  // 渠道完成指定流程、新展签生效后调用
  markEffective(channelId, revisionId) {
    const note = this.forChannel(channelId).find((n) => n.revision_id === revisionId);
    if (!note) return null;
    return this._update(note.id, {
      state: "effective",
      delivered_at: this._notifications.find((n) => n.id === note.id).delivered_at ?? this._clock().toISOString(),
      effective_at: this._clock().toISOString(),
    });
  }

  // 合作机构离线确认后的迟到回执：只记账，永不改变当前版本。
  // ack_version 低于该渠道当前版本时标记 late_ignored（防降级的审计证据）。
  recordReceipt(channelId, { ack_version, ack_revision_id, received_by, issued_at }, currentVersion) {
    const receipt = Object.freeze({
      channel_id: channelId,
      ack_version,
      ack_revision_id,
      received_by,
      issued_at: issued_at ?? null, // 合作机构实际签字时间（可能在离线期）
      arrived_at: this._clock().toISOString(), // 回执到达本馆时间
      status: currentVersion != null && ack_version < currentVersion ? "late_ignored" : "recorded",
    });
    this._receiptLog.push(receipt);
    return receipt;
  }

  receipts() {
    return [...this._receiptLog];
  }

  all() {
    return [...this._notifications];
  }
}
