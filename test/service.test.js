import assert from "node:assert/strict";
import test from "node:test";

import { loadSeed } from "../src/seed.js";
import { Confidence, ResearchService } from "../src/service.js";

const CLAIM = "claim-dry-compass";
const ARTIFACT = "artifact-compass-figure";
const WEBSITE = "museum-website";
const SCHOOL = "school-course";
const LOAN = "loan-exhibition";

// 以种子资料中的陶俑与研究主张为起点，搭建完整场景：
// 并行评审发布 v1（已证实）→ 新检测记录触发紧急勘误 v2（下调为可能）→
// 外借渠道延迟同步，期间收到合作机构的迟到回执 → 所有缓存收敛到 v2。
async function buildScenario() {
  let now = "2026-01-10T09:00:00.000Z";
  const service = new ResearchService({ clock: () => now });
  const at = (d) => {
    now = new Date(d).toISOString();
    return now;
  };

  const seed = await loadSeed();
  const artifact = seed.records.find((r) => r.id === ARTIFACT);
  const claim = seed.records.find((r) => r.id === CLAIM);

  service.registerArtifact(
    { id: artifact.id, period: artifact.period, excavatedIn: artifact.excavated_in, features: artifact.features },
    at("2026-01-10"),
  );
  service.openClaim({ id: claim.id, artifactId: artifact.id, subject: claim.statement }, at("2026-01-10"));

  // 证据分类登记：器物特征 / 出土背景 / 检测记录 / 文献引文，彼此分开。
  service.recordEvidence(
    { id: "ev-feature", artifactId: ARTIFACT, kind: "feature", summary: "支轴磁针与竖直盘面结构" },
    at("2026-01-11"),
  );
  service.recordEvidence(
    { id: "ev-excavation", artifactId: ARTIFACT, kind: "excavation", summary: "抚州临川南宋墓出土层位" },
    at("2026-01-11"),
  );
  service.recordEvidence(
    { id: "ev-test-tl", artifactId: ARTIFACT, kind: "test", summary: "热释光测年报告（2025）" },
    at("2026-01-12"),
  );
  service.recordEvidence(
    { id: "ev-citation", artifactId: ARTIFACT, kind: "citation", summary: "《梦粱录》针路记载对照" },
    at("2026-01-12"),
  );

  // 竞争解释并存；研究者观点单独保存并挂到解释上。
  service.proposeInterpretation(
    { id: "int-early", claimId: CLAIM, author: "李研究员", statement: "旱罗盘在十二世纪已投入使用" },
    at("2026-01-15"),
  );
  service.proposeInterpretation(
    { id: "int-late", claimId: CLAIM, author: "王研究员", statement: "仅十四世纪文献可作为确证" },
    at("2026-01-15"),
  );
  service.recordOpinion(
    { id: "op-li", claimId: CLAIM, researcher: "李研究员", position: "支持上溯至十二世纪", interpretationId: "int-early" },
    at("2026-01-16"),
  );
  service.recordOpinion(
    { id: "op-wang", claimId: CLAIM, researcher: "王研究员", position: "十二世纪说证据不足", interpretationId: "int-late" },
    at("2026-01-16"),
  );

  service.registerChannel({ id: WEBSITE, kind: "online", label: "博物馆网站" }, at("2026-01-20"));
  service.registerChannel({ id: SCHOOL, kind: "online", label: "学校课程" }, at("2026-01-20"));
  service.registerChannel({ id: LOAN, kind: "offline", label: "外借展览" }, at("2026-01-20"));

  // v1：结论“已证实”，走常规并行评审。
  service.draftRevision(
    {
      id: "rev1",
      claimId: CLAIM,
      interpretationId: "int-early",
      statement: "旱罗盘的使用已证实可上溯至十二世纪。",
      confidence: Confidence.CONFIRMED,
      evidenceIds: ["ev-feature", "ev-excavation", "ev-test-tl", "ev-citation"],
      workflow: "standard",
    },
    at("2026-02-01"),
  );
  service.submitReview({ revisionId: "rev1", reviewer: "赵评审", decision: "approve", comment: "证据链完整" }, at("2026-02-02"));
  service.submitReview(
    { revisionId: "rev1", reviewer: "孙评审", decision: "reject", comment: "测年样本不足以支撑“已证实”" },
    at("2026-02-03"),
  );
  service.submitReview({ revisionId: "rev1", reviewer: "钱评审", decision: "approve", comment: "同意发布" }, at("2026-02-04"));

  service.lockTranslation({ id: "tr-rev1-en", revisionId: "rev1", language: "en", text: "The dry compass is confirmed to date back to the 12th century." }, at("2026-02-05"));
  service.publishRevision({ revisionId: "rev1", channelId: WEBSITE }, at("2026-02-05"));
  service.publishRevision({ revisionId: "rev1", channelId: SCHOOL }, at("2026-02-05"));
  service.publishRevision({ revisionId: "rev1", channelId: LOAN }, at("2026-02-05"));
  // 外借展览为离线渠道，开展时才同步上墙。
  service.syncChannel(LOAN, at("2026-02-20"), "loan-opening");

  // 新检测记录动摇原结论 → 紧急勘误 v2，下调为“可能”。
  service.recordEvidence(
    { id: "ev-test-met", artifactId: ARTIFACT, kind: "test", summary: "磁针金相检测显示后世扰动迹象" },
    at("2026-05-30"),
  );
  service.draftRevision(
    {
      id: "rev2",
      claimId: CLAIM,
      interpretationId: "int-early",
      statement: "旱罗盘的出现可能早至十二世纪，尚待更多证据。",
      confidence: Confidence.POSSIBLE,
      evidenceIds: ["ev-feature", "ev-excavation", "ev-test-tl", "ev-citation", "ev-test-met"],
      reason: "新检测记录对出土层位提出疑问，结论由“已证实”下调为“可能”",
      workflow: "urgent",
    },
    at("2026-06-01"),
  );
  service.submitReview({ revisionId: "rev2", reviewer: "周主编", decision: "approve", comment: "同意紧急勘误" }, at("2026-06-02"));
  service.lockTranslation({ id: "tr-rev2-en", revisionId: "rev2", language: "en", text: "The dry compass may date back to the 12th century; further evidence is needed." }, at("2026-06-03"));
  service.publishRevision({ revisionId: "rev2", channelId: WEBSITE }, at("2026-06-03"));
  service.publishRevision({ revisionId: "rev2", channelId: SCHOOL }, at("2026-06-03"));
  service.publishRevision({ revisionId: "rev2", channelId: LOAN }, at("2026-06-03"));

  // 合作机构离线确认旧展签，回执迟到：只记录，不得降级。
  service.receiveReceipt({ channelId: LOAN, revisionId: "rev1", note: "合作馆线下确认收到旧展签" }, at("2026-06-10"));
  // 外借展览延迟同步，缓存追上 v2。
  service.syncChannel(LOAN, at("2026-06-20"), "loan-resync");
  // 又一份迟到回执：依然不能把已同步的新内容降级。
  service.receiveReceipt({ channelId: LOAN, revisionId: "rev1", note: "合作馆补寄的纸质回执" }, at("2026-06-25"));

  return { service, at };
}

test("并行评审、紧急勘误与外借延迟同步后，所有渠道缓存收敛到正确版本", async () => {
  const { service } = await buildScenario();

  // 收敛：三个渠道当前展示的都是 v2。
  for (const channelId of [WEBSITE, SCHOOL, LOAN]) {
    const channel = service.channels.get(channelId);
    assert.equal(channel.displayed.get(CLAIM), "rev2", `${channelId} 应收敛到 rev2`);
  }

  // 每个渠道曾经展示过的内容都保留，旧展签未被覆盖。
  const schoolHistory = service.channelHistory(SCHOOL);
  assert.deepEqual(
    schoolHistory.map((h) => [h.revisionId, h.confidence]),
    [
      ["rev1", "confirmed"],
      ["rev2", "possible"],
    ],
  );
  assert.equal(schoolHistory[0].statement, "旱罗盘的使用已证实可上溯至十二世纪。");

  const loanHistory = service.channelHistory(LOAN);
  assert.deepEqual(
    loanHistory.map((h) => [h.revisionId, h.at.slice(0, 10), h.cause]),
    [
      ["rev1", "2026-02-20", "loan-opening"],
      ["rev2", "2026-06-20", "loan-resync"],
    ],
  );

  // 仍在分发旧版本的渠道收到了带理由的勘误通知。
  const loanNotices = service.notificationsFor(LOAN);
  assert.equal(loanNotices.length, 1);
  assert.equal(loanNotices[0].type, "errata");
  assert.equal(loanNotices[0].fromRevision, "rev1");
  assert.equal(loanNotices[0].toRevision, "rev2");
  assert.match(loanNotices[0].reason, /下调为“可能”/);
  assert.equal(loanNotices[0].pending, false, "同步完成后通知不再待处理");

  // 迟到回执被记录为 stale，且从未改变已发布或已展示内容。
  const receipts = service.channels.get(LOAN).receipts;
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((r) => r.stale));
  assert.equal(service.channels.get(LOAN).published.get(CLAIM), "rev2");
  assert.equal(service.channels.get(LOAN).displayed.get(CLAIM), "rev2");
});

test("公众查询得到当前表述及证据边界，译文锁定同一事实版本", async () => {
  const { service } = await buildScenario();

  const current = service.publicStatement(CLAIM);
  assert.equal(current.confidence, "possible");
  assert.equal(current.confidenceLabel, "可能");
  assert.equal(current.statement, "旱罗盘的出现可能早至十二世纪，尚待更多证据。");
  assert.equal(current.evidenceBoundary.length, 5);
  assert.ok(current.evidenceBoundary.some((e) => e.kind === "test" && e.id === "ev-test-met"));
  assert.equal(current.competingInterpretationCount, 2, "竞争解释并存");

  // 历史时点：2026-03-01 时对外表述仍是 v1。
  const inMarch = service.publicStatement(CLAIM, { at: "2026-03-01" });
  assert.equal(inMarch.version, 1);
  assert.equal(inMarch.confidence, "confirmed");

  // 译文锁定：当前查询返回 v2 译文，历史时点返回 v1 译文。
  const enNow = service.publicStatement(CLAIM, { language: "en" });
  assert.match(enNow.translation.text, /may date back/);
  assert.equal(enNow.translation.lockedTo, "rev2");
  const enMarch = service.publicStatement(CLAIM, { at: "2026-03-01", language: "en" });
  assert.match(enMarch.translation.text, /is confirmed/);

  // 没有锁定译文的语言：明确缺失，绝不拿旧版本译文冒充。
  const ja = service.publicStatement(CLAIM, { language: "ja" });
  assert.equal(ja.translation.text, null);
  assert.equal(ja.translation.status, "missing");
});

test("内部人员可按历史日期还原展陈文字、批准者和未采纳意见", async () => {
  const { service } = await buildScenario();

  // 2026-03-15：学校课程仍展示 v1。
  const schoolMarch = service.channelDisplayAt(SCHOOL, "2026-03-15");
  assert.equal(schoolMarch.displays.length, 1);
  const view = schoolMarch.displays[0];
  assert.equal(view.revisionId, "rev1");
  assert.equal(view.statement, "旱罗盘的使用已证实可上溯至十二世纪。");
  assert.deepEqual(view.approvers.sort(), ["赵评审", "钱评审"]);
  assert.ok(view.rejectedOpinions.some((r) => r.source === "review" && r.reviewer === "孙评审"));
  assert.ok(view.rejectedOpinions.some((r) => r.source === "opinion" && r.researcher === "王研究员"));

  // 2026-06-15：勘误已发布，但外借展览尚未同步，仍展示 v1——这正是“某一天各渠道实际对外表达了什么”。
  const loanMid = service.channelDisplayAt(LOAN, "2026-06-15");
  assert.equal(loanMid.displays[0].revisionId, "rev1");
  const websiteMid = service.channelDisplayAt(WEBSITE, "2026-06-15");
  assert.equal(websiteMid.displays[0].revisionId, "rev2");

  // 今天：所有渠道都是 v2。
  const loanNow = service.channelDisplayAt(LOAN, "2026-09-30");
  assert.equal(loanNow.displays[0].revisionId, "rev2");
  assert.deepEqual(loanNow.displays[0].approvers, ["周主编"]);
});

test("撤回生成带理由的新修订并通知仍在分发的渠道", async () => {
  const { service, at } = await buildScenario();

  service.retractClaim(
    { id: "rev3", claimId: CLAIM, reason: "出土层位报告被证伪，撤回十二世纪相关表述", reviewer: "周主编" },
    at("2026-07-01"),
  );
  for (const channelId of [WEBSITE, SCHOOL, LOAN]) {
    service.publishRevision({ revisionId: "rev3", channelId }, at("2026-07-02"));
  }

  // 三个渠道都收到撤回通知；外借渠道在同步前通知处于待处理状态。
  const loanNotices = service.notificationsFor(LOAN);
  const retraction = loanNotices.find((n) => n.type === "retraction");
  assert.ok(retraction, "外借渠道应收到撤回通知");
  assert.equal(retraction.fromRevision, "rev2");
  assert.match(retraction.reason, /撤回/);
  assert.equal(retraction.pending, true);

  // 公众查询：当前表述为已撤回，并给出理由。
  const current = service.publicStatement(CLAIM);
  assert.equal(current.confidence, "retracted");
  assert.match(current.statement, /撤回/);
  assert.match(current.reason, /层位报告被证伪/);

  // 外借渠道同步后收敛到撤回版本，历史三段完整保留。
  service.syncChannel(LOAN, at("2026-07-10"), "loan-resync");
  const history = service.channelHistory(LOAN);
  assert.deepEqual(
    history.map((h) => h.revisionId),
    ["rev1", "rev2", "rev3"],
  );
  assert.equal(history[1].statement, "旱罗盘的出现可能早至十二世纪，尚待更多证据。");
  assert.equal(service.channels.get(LOAN).displayed.get(CLAIM), "rev3");
});

test("学术流程与版本不变量守卫", async () => {
  let now = "2026-01-01T00:00:00.000Z";
  const service = new ResearchService({ clock: () => now });
  service.registerArtifact({ id: "a1", period: "南宋", excavatedIn: "临川", features: [] });
  service.openClaim({ id: "c1", artifactId: "a1", subject: "测试主张" });
  service.recordEvidence({ id: "e1", artifactId: "a1", kind: "test", summary: "检测一" });
  service.registerChannel({ id: "ch", kind: "online" });

  // 未走完学术流程的修订不能发布。
  service.draftRevision({ id: "r1", claimId: "c1", statement: "草稿", confidence: "possible", evidenceIds: ["e1"] });
  assert.throws(() => service.publishRevision({ revisionId: "r1", channelId: "ch" }), /未完成学术流程/);

  // 紧急勘误必须填写理由。
  assert.throws(
    () =>
      service.draftRevision({ id: "r2", claimId: "c1", statement: "勘误", confidence: "possible", workflow: "urgent" }),
    /必须填写理由/,
  );

  // 同一评审人不能重复评审。
  service.submitReview({ revisionId: "r1", reviewer: "甲", decision: "approve" });
  assert.throws(
    () => service.submitReview({ revisionId: "r1", reviewer: "甲", decision: "approve" }),
    /已提交过评审/,
  );

  // 译文锁定后不能改写。
  service.submitReview({ revisionId: "r1", reviewer: "乙", decision: "approve" });
  service.lockTranslation({ id: "t1", revisionId: "r1", language: "en", text: "v1" });
  assert.throws(
    () => service.lockTranslation({ id: "t2", revisionId: "r1", language: "en", text: "v1改" }),
    /已锁定/,
  );

  // 不允许把渠道回退到旧版本。
  service.publishRevision({ revisionId: "r1", channelId: "ch" });
  service.draftRevision({
    id: "r3",
    claimId: "c1",
    statement: "新版",
    confidence: "confirmed",
    evidenceIds: ["e1"],
    workflow: "urgent",
    reason: "补充证据",
  });
  service.submitReview({ revisionId: "r3", reviewer: "丙", decision: "approve" });
  service.publishRevision({ revisionId: "r3", channelId: "ch" });
  assert.throws(() => service.publishRevision({ revisionId: "r1", channelId: "ch" }), /回退/);

  // 未知证据类别被拒绝。
  assert.throws(
    () => service.recordEvidence({ id: "e2", artifactId: "a1", kind: "rumor", summary: "传闻" }),
    /未知证据类别/,
  );
});
