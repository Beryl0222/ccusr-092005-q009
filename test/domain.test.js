import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceStore } from "../src/domain/evidence-store.js";
import { RevisionLedger, STATUS, STATUS_LABEL } from "../src/domain/revision-ledger.js";
import { ReviewOffice } from "../src/domain/review-office.js";
import { Channel, PublicationLog, NotifyBoard } from "../src/domain/publication-channel.js";
import { TranslationRegistry } from "../src/domain/translation-registry.js";

const evidenceRows = [
  { id: "e1", kind: "artifact_feature", claim_ids: ["c1"], summary: "支轴" },
  { id: "e2", kind: "examination_record", claim_ids: ["c1"], summary: "X光" },
  { id: "e3", kind: "researcher_view", claim_ids: ["c1"], summary: "潘说" },
];

const claim = {
  id: "c1",
  statement: "年代主张",
  interpretations: [
    { id: "i-a", label: "甲说", summary: "甲", opened_at: "2000-01-01" },
    { id: "i-b", label: "乙说", summary: "乙", opened_at: "2020-01-01" },
  ],
};

function ledgerWith(evidence = new EvidenceStore(evidenceRows)) {
  return new RevisionLedger([claim], evidence);
}

test("证据按五类分开保存且只读", () => {
  const store = new EvidenceStore(evidenceRows);
  assert.deepEqual(store.list({ kind: "artifact_feature" }).map((r) => r.id), ["e1"]);
  assert.equal(store.groupedByIds(["e1", "e2", "e3"]).researcher_view[0].id, "e3");
  assert.throws(() => store.add({ id: "x", kind: "bogus", claim_ids: [] }), /未知证据类别/);
  const row = store.get("e1");
  assert.throws(() => { row.summary = "改"; }, TypeError);
});

test("竞争解释并存：同一主张可挂多种解释，修订仅标注倾向", () => {
  const ledger = ledgerWith();
  ledger.seed({
    id: "c1-v1", claim_id: "c1", version: 1, status: "confirmed",
    wording: { public: "甲说成立" }, basis: ["e1", "e3"],
    rationale: "初版", created_by: "甲", created_at: "2000-01-01T00:00:00Z",
    favored_interpretation: "i-a",
  });
  const v2 = ledger.revise({
    claim_id: "c1", status: "possible", favored_interpretation: "i-b",
    wording: { public: "存疑" }, basis: ["e1", "e2"],
    rationale: "新检测", created_by: "乙", created_at: "2026-01-01T00:00:00Z",
  });
  assert.equal(v2.version, 2);
  assert.equal(ledger.claim("c1").interpretations.length, 2);
  assert.equal(ledger.get("c1-v1").wording.public, "甲说成立"); // 旧版仍在
});

test("状态迁移与理由校验", () => {
  const ledger = ledgerWith();
  ledger.seed({
    id: "c1-v1", claim_id: "c1", version: 1, status: "confirmed",
    wording: { public: "成立" }, basis: ["e1"], rationale: "初版",
    created_by: "甲", created_at: "2000-01-01T00:00:00Z",
  });
  assert.throws(
    () => ledger.revise({
      claim_id: "c1", status: "confirmed", wording: { public: "x" },
      basis: ["e1"], rationale: "无变化", created_by: "乙", created_at: "2026-01-01",
    }),
    /同态修订/
  );
  assert.throws(
    () => ledger.revise({
      claim_id: "c1", status: "possible", wording: { public: "x" },
      basis: ["e1"], rationale: "   ", created_by: "乙", created_at: "2026-01-01",
    }),
    /必须附带理由/
  );
  assert.throws(
    () => ledger.revise({
      claim_id: "c1", status: "possible", wording: { public: "x" },
      basis: ["missing"], rationale: "引用幽灵证据", created_by: "乙", created_at: "2026-01-01",
    }),
    /不存在的证据/
  );
  // confirmed → possible → withdrawn 合法；withdrawn 不能直接回 confirmed
  ledger.revise({
    claim_id: "c1", status: "possible", wording: { public: "存疑" },
    basis: ["e1"], rationale: "动摇", created_by: "乙", created_at: "2026-02-01",
  });
  ledger.revise({
    claim_id: "c1", status: "withdrawn", wording: { public: "撤回" },
    basis: ["e1"], rationale: "不成立", created_by: "乙", created_at: "2026-03-01",
  });
  assert.throws(
    () => ledger.revise({
      claim_id: "c1", status: "confirmed", wording: { public: "复活" },
      basis: ["e1"], rationale: "想直接翻案", created_by: "丙", created_at: "2026-04-01",
    }),
    /不允许/
  );
  assert.equal(ledger.latest("c1").status, STATUS.WITHDRAWN);
  assert.equal(STATUS_LABEL[ledger.asOf("c1", "2026-02-15").status], "可能");
});

test("只有走完渠道指定流程才能发布；并行异议归档保留", () => {
  const office = new ReviewOffice();
  const channel = new Channel({
    id: "ch", name: "渠道",
    required_stages: ["peer_review", "editorial_board"],
    emergency_stages: ["editorial_board"],
  });
  const revision = { id: "c1-v2", claim_id: "c1", version: 2, wording: { public: "存疑" } };
  const process = office.open({ id: "p1", revision, channel });
  process.submitReview({ reviewer: "R1", vote: "support", comment: "同意" });
  process.submitReview({ reviewer: "R2", vote: "dissent", comment: "反对，保留旧说" });
  assert.equal(process.isComplete(), false);
  process.approve("peer_review", "召集人");
  assert.throws(
    () => process.approve("nonexistent_stage", "x"), /本流程不包含/
  );
  process.approve("editorial_board", "委员会");
  assert.equal(process.isComplete(), true);
  assert.equal(process.dissentingReviews()[0].reviewer, "R2"); // 未采纳意见仍可查
  assert.equal(process.dissentingReviews()[0].considered, false);

  // 否决的流程不能发布
  const rejected = office.open({ id: "p2", revision, channel });
  rejected.reject("委员会", "证据不足");
  assert.equal(rejected.isRejected(), true);
  assert.equal(rejected.isComplete(), false);
});

test("展签只追加不覆盖，并拒绝任何形式的版本降级", () => {
  const channel = new Channel({ id: "ch", name: "渠道", required_stages: [], emergency_stages: [] });
  const log = new PublicationLog(channel);
  const rev = (n, id) => ({ id: `c1-v${n}`, claim_id: "c1", version: n, wording: { public: id } });
  log.append({ revision: rev(1, "旧"), label: "旧", approver: "甲", at: "2026-01-01" });
  log.append({ revision: rev(2, "新"), label: "新", approver: "乙", at: "2026-02-01" });
  assert.throws(() => log.append({ revision: rev(2, "重复"), label: "重复", approver: "乙", at: "2026-02-02" }), /禁止重复发布/);
  assert.throws(() => log.append({ revision: rev(1, "降级"), label: "降级", approver: "丙", at: "2026-03-01" }), /禁止被旧版本/);
  assert.equal(log.history().length, 2); // 失败的追加没有写入
  assert.equal(log.current().label, "新");
  assert.equal(log.asOf("2026-01-15").label, "旧");
  // 历史条目不可变
  assert.throws(() => { log.history()[0].label = "覆盖"; }, TypeError);
});

test("译文必须锁定同一事实版本", () => {
  const registry = new TranslationRegistry();
  const v2 = { id: "c1-v2", version: 2 };
  const v3 = { id: "c1-v3", version: 3 };
  registry.register(v2, "en", "possible...", "译者");
  assert.throws(() => registry.register(v2, "en", "again", "译者"), /已锁定/);
  assert.throws(() => registry.lockedTranslations(v3, ["en"]), /缺少锁定/);
  registry.register(v3, "en", "withdrawn...", "译者");
  assert.equal(registry.lockedTranslations(v3, ["en"]).en, "withdrawn...");
});

test("迟到回执只记账：版本落后标记 late_ignored，不触发任何变更", () => {
  const board = new NotifyBoard({ clock: () => new Date("2026-04-13T00:00:00Z") });
  const stale = board.recordReceipt(
    "ch-loan",
    { ack_version: 2, ack_revision_id: "c1-v2", received_by: "对方值班员", issued_at: "2026-04-09" },
    3
  );
  assert.equal(stale.status, "late_ignored");
  const current = board.recordReceipt(
    "ch-loan",
    { ack_version: 3, ack_revision_id: "c1-v3", received_by: "对方值班员" },
    3
  );
  assert.equal(current.status, "recorded");
  assert.equal(board.receipts().length, 2);
});
