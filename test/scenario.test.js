import assert from "node:assert/strict";
import test from "node:test";

import { ResearchPublicationService } from "../src/domain/service.js";
import { runScenario, CLAIM } from "../src/scenario.js";

// 端到端：并行评审 → 紧急勘误 → 离线延迟同步 → 全渠道收敛，历史全程保留
test("完整场景：三渠道最终收敛到 v3，旧展签与未采纳意见均可还原", async () => {
  const { service, convergence, lateReceipt, blockedPublishError } = await runScenario();

  assert.equal(convergence.全部收敛, true);
  assert.deepEqual(
    convergence.各渠道.map((r) => [r.当前版本, r.通知状态, r.待补常规流程]),
    [[3, "effective", false], [3, "effective", false], [3, "effective", false]]
  );

  // 迟到回执被识别且未造成降级；依据迟到确认发布旧版被拒
  assert.equal(lateReceipt.status, "late_ignored");
  assert.match(blockedPublishError, /已被更新修订取代/);

  // 每个渠道的展签历史都完整保留（官网三条：v1/v2/v3）
  const webHistory = service.channelHistory("ch-website");
  assert.deepEqual(webHistory.map((e) => e.version), [1, 2, 3]);
  assert.deepEqual(webHistory.map((e) => e.kind), ["publication", "publication", "erratum"]);
  const loanHistory = service.channelHistory("ch-loan");
  assert.deepEqual(loanHistory.map((e) => e.version), [1, 3]); // v2 从未在外借渠道展示
  const schoolHistory = service.channelHistory("ch-school");
  assert.deepEqual(schoolHistory.map((e) => e.version), [1, 2, 3]);

  // 旧展签不能被覆盖：v1 原文仍在日志中
  assert.match(webHistory[0].label, /至迟在十二世纪/);

  // 关键日期的“各渠道实际对外表达”可还原
  const night = service.internalAsOf(CLAIM, "2026-04-06T23:59:59+08:00");
  assert.deepEqual(
    night.渠道.map((c) => c.对应版本),
    [1, 2, 1] // 学校仍旧版、官网已谨慎版、外借仍旧版
  );

  // 内部可查批准者与未采纳意见
  const schoolAtPeak = service.internalAsOf(CLAIM, "2026-04-07T12:00:00+08:00");
  const schoolRow = schoolAtPeak.渠道.find((c) => c.渠道.includes("学校"));
  assert.equal(schoolRow.批准者, "教材编辑委员会·章季兰");
  assert.ok(schoolRow.评审与未采纳意见.some((r) => r.立场.includes("异议") && r.是否采纳 === false));

  // 公众查询：当前撤回表述 + 证据边界（检测记录在列）+ 两种竞争解释并存
  const pub = service.publicQuery(CLAIM);
  assert.equal(pub.当前结论, "已撤回");
  assert.ok(pub.证据边界["检测记录"].length >= 2);
  assert.equal(pub.竞争解释.length, 2);
  assert.deepEqual(pub.各渠道当前表述.map((c) => c.版本), [3, 3, 3]);
});

test("发布门禁：流程未走完不得发布；紧急发布须后补常规流程", async () => {
  const { service } = await runScenario();
  // 新开一条降级再确认的修订链用于独立门禁测试
  service.revise({
    id: "rev-gate-v4", claim_id: CLAIM, status: "possible",
    wording: { public: "重新研究中的谨慎表述" },
    basis: ["ev-exam-2026-adhesive"],
    rationale: "新研究线索使撤回结论以“可能”重启调查",
    created_by: "测试", created_at: "2026-05-01T09:00:00+08:00",
  });
  const process = service.openReview({
    process_id: "rp-gate", revision_id: "rev-gate-v4", channel_id: "ch-website",
  });
  assert.throws(
    () => service.publish({
      revision_id: "rev-gate-v4", channel_id: "ch-website",
      process_id: "rp-gate", approver: "x",
    }),
    /流程尚未走完/
  );
  process.approve("peer_review", "评审召集人");
  assert.throws(
    () => service.publish({
      revision_id: "rev-gate-v4", channel_id: "ch-website",
      process_id: "rp-gate", approver: "x",
    }),
    /策展委员会/
  );
  process.approve("curatorial_committee", "委员会");
  const entry = service.publish({
    revision_id: "rev-gate-v4", channel_id: "ch-website",
    process_id: "rp-gate", approver: "委员会",
  });
  assert.equal(entry.version, 4);
});

test("译文锁：渠道要求随附译文时，旧修订译文不得用于新修订", async () => {
  const seed = {
    project: "t",
    evidence: [{ id: "e1", kind: "artifact_feature", claim_ids: ["c1"], summary: "x" }],
    claims: [{
      id: "c1", statement: "s",
      interpretations: [
        { id: "i1", label: "a", summary: "a" },
        { id: "i2", label: "b", summary: "b" },
      ],
    }],
    conclusions: [{
      id: "c1-v1", claim_id: "c1", version: 1, status: "confirmed",
      wording: { public: "旧" }, basis: ["e1"], rationale: "r",
      created_by: "x", created_at: "2026-01-01",
    }],
    channels: [{ id: "web", name: "网", required_stages: ["curatorial_committee"], emergency_stages: ["curatorial_committee"] }],
    publications: [{
      channel_id: "web", revision_id: "c1-v1", label: "旧",
      approver: "x", published_at: "2026-01-02",
    }],
  };
  const svc = new ResearchPublicationService(seed);
  const v2 = svc.revise({
    claim_id: "c1", status: "possible", wording: { public: "新" },
    basis: ["e1"], rationale: "存疑", created_by: "y",
  });
  svc.translations.register({ id: "c1-v1", version: 1 }, "en", "old", "translator");
  const p = svc.openReview({ process_id: "p", revision_id: v2.id, channel_id: "web" });
  p.approve("curatorial_committee", "c");
  assert.throws(
    () => svc.publish({ revision_id: v2.id, channel_id: "web", process_id: "p", approver: "c", langs: ["en"] }),
    /缺少锁定/
  );
});
