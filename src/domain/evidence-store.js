// 证据分储：器物特征、出土背景、检测记录、文献引文、研究者观点
// 五类证据各自独立存档，只能被修订引用，不能被修订改写。

export const EVIDENCE_KINDS = Object.freeze({
  artifact_feature: "器物特征",
  excavation_context: "出土背景",
  examination_record: "检测记录",
  literature_citation: "文献引文",
  researcher_view: "研究者观点",
});

export class EvidenceStore {
  constructor(records = []) {
    this._byId = new Map();
    for (const record of records) this.add(record);
  }

  add(record) {
    if (!record || !record.id) throw new Error("证据必须具备稳定标识");
    if (!EVIDENCE_KINDS[record.kind]) {
      throw new Error(`未知证据类别：${record.kind}`);
    }
    if (this._byId.has(record.id)) {
      throw new Error(`证据标识重复：${record.id}`);
    }
    const frozen = Object.freeze({ ...record, claim_ids: [...(record.claim_ids ?? [])] });
    this._byId.set(record.id, frozen);
    return frozen;
  }

  get(id) {
    const record = this._byId.get(id);
    if (!record) throw new Error(`证据不存在：${id}`);
    return record;
  }

  exists(id) {
    return this._byId.has(id);
  }

  list(filter = {}) {
    let rows = [...this._byId.values()];
    if (filter.kind) rows = rows.filter((r) => r.kind === filter.kind);
    if (filter.claimId) rows = rows.filter((r) => r.claim_ids.includes(filter.claimId));
    if (filter.recordedBefore) {
      rows = rows.filter((r) => !r.recorded_at || r.recorded_at <= filter.recordedBefore);
    }
    return rows;
  }

  // 按五类分别归档，供公众查询展示证据边界
  groupedByIds(ids) {
    const groups = {};
    for (const kind of Object.keys(EVIDENCE_KINDS)) groups[kind] = [];
    for (const id of ids) {
      const record = this.get(id);
      groups[record.kind].push(record);
    }
    return groups;
  }
}
