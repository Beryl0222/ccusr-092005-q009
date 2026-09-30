// 端到端叙事：
//   旧版“南宋旱罗盘”结论 v1（已证实）长期挂在官网、课程、外借展览三个渠道；
//   2026 年新检测触发并行评审 → 降级 v2（可能）→ 紧急勘误 v3（撤回）；
//   外借渠道离线，恢复后直接同步 v3；离线期间签署的 v2 迟到回执不得降级；
//   最终所有渠道缓存收敛到 v3，且每个渠道曾经展示的展签全部保留、可按日期还原。

import { loadSeed } from "./seed.js";
import { ResearchPublicationService } from "./domain/service.js";

export const CLAIM = "claim-dry-compass";
export const V1 = "rev-dry-compass-v1";
export const V2 = "rev-dry-compass-v2";
export const V3 = "rev-dry-compass-v3";

export async function runScenario(seedPath = "fixtures/seed.json") {
  const seed = await loadSeed(seedPath);
  let now = new Date("2026-04-06T09:00:00+08:00");
  const clock = () => now;
  const at = (iso, fn) => {
    now = new Date(iso);
    return fn();
  };

  const svc = new ResearchPublicationService(seed, { clock });
  const log = [];
  const say = (section, text) => log.push(`【${section}】${text}`);

  // —— 0. 勘误前的世界：三个渠道都在分发 v1，措辞各自不同 ——
  say("勘误前", "官网、学校课程、外借展览均展示 v1（已证实）：旱罗盘至迟十二世纪已在中国使用。");

  // —— 1. 新检测：提出降级修订 v2（已证实 → 可能），自动通知所有在分发旧版的渠道 ——
  let v2;
  at("2026-04-06T10:00:00+08:00", () => {
    v2 = svc.revise({
      id: V2,
      claim_id: CLAIM,
      status: "possible",
      favored_interpretation: "int-pivot-restoration",
      wording: {
        public:
          "现有证据不足以确认旱罗盘在十二世纪已在中国使用：陶俑支轴检出近代合成胶粘剂，" +
          "支轴式磁针装置的文献记载不早于十四世纪；该问题仍在研究中。",
      },
      basis: [
        "ev-exam-2026-adhesive",
        "ev-feature-dial",
        "ev-excavation-linchuan-1985",
        "ev-citation-shilin-guangji",
        "ev-citation-pingzhou-ketan",
        "ev-view-panel-2026",
      ],
      rationale:
        "2026年显微观察发现支轴根部存在近代合成胶粘剂与二次打磨痕，原器判定被动摇，故由“已证实”调整为“可能”。",
      created_by: "馆藏器物复核小组",
    });
  });
  say(
    "提出 v2",
    `复核小组生成 ${V2}（可能），已向 ${svc.notify.all().length} 个仍在分发 v1 的渠道发出通知。`
  );

  // —— 2. 并行评审：官网、学校两条常规流程同时开；评审意见并行提交，异议保留不采纳 ——
  const webReview = svc.openReview({
    process_id: "rp-web-v2",
    revision_id: V2,
    channel_id: "ch-website",
  });
  const schoolReview = svc.openReview({
    process_id: "rp-school-v2",
    revision_id: V2,
    channel_id: "ch-school",
  });

  const webOpinions = [
    { reviewer: "评审人·苏蘅", interpretation_id: "int-pivot-restoration", vote: "support",
      comment: "胶粘剂证据可信，原器说应搁置，同意降级为可能。" },
    { reviewer: "评审人·郦行健", interpretation_id: "int-pivot-restoration", vote: "support",
      comment: "《萍洲可谈》所记为水浮磁针，不能支撑十二世纪旱罗盘。" },
    { reviewer: "评审人·潘其樟", interpretation_id: "int-song-dry-compass", vote: "dissent",
      comment: "胶粘剂或系后期保护处理渗入，不足以否定1990年X光判读，主张维持已证实。" },
  ];
  const schoolOpinions = [
    { reviewer: "教材审读·傅明", interpretation_id: "int-pivot-restoration", vote: "support",
      comment: "教材必须随证据修订，同意改用谨慎表述。" },
    { reviewer: "教材审读·高颂平", interpretation_id: "int-song-dry-compass", vote: "dissent",
      comment: "担心改动过频影响教学稳定性，建议暂缓。" },
  ];
  await Promise.all([
    ...webOpinions.map((o) => Promise.resolve().then(() => webReview.submitReview(o))),
    ...schoolOpinions.map((o) => Promise.resolve().then(() => schoolReview.submitReview(o))),
  ]);
  webReview.markConsidered(["评审人·苏蘅", "评审人·郦行健"]); // 潘其樟意见未采纳，但归档保留
  schoolReview.markConsidered(["教材审读·傅明"]); // 高颂平意见未采纳，但归档保留

  at("2026-04-06T15:00:00+08:00", () => {
    webReview.approve("peer_review", "学术评审召集人·梅守正");
    webReview.approve("curatorial_committee", "策展委员会·纪衡");
  });
  at("2026-04-06T16:00:00+08:00", () => {
    svc.publish({
      revision_id: V2,
      channel_id: "ch-website",
      process_id: "rp-web-v2",
      approver: "策展委员会·纪衡",
    });
  });
  say("官网更新", "博物馆官网走完同行评审+策展委员会，v2（可能）上线，措辞转为谨慎。");

  // 学校编辑委员会次日才开会 —— 4月6日晚“网站已更新、课程仍讲旧版”
  const night0406 = svc.internalAsOf(CLAIM, "2026-04-06T23:59:59+08:00");
  const thatNight = night0406.渠道.map(
    (c) => `${c.渠道}=v${c.对应版本 ?? "-"}`
  ).join("，");
  say("4月6日深夜快照", thatNight);

  at("2026-04-07T09:30:00+08:00", () => {
    schoolReview.approve("peer_review", "教材评审召集人·闻子实");
    schoolReview.approve("editorial_board", "教材编辑委员会·章季兰");
    svc.publish({
      revision_id: V2,
      channel_id: "ch-school",
      process_id: "rp-school-v2",
      approver: "教材编辑委员会·章季兰",
      label: "关于旱罗盘最早使用年代，学界尚有争议；教材采用谨慎表述：现存实物证据不足以证明十二世纪已使用旱罗盘。",
    });
  });
  say("课程更新", "学校课程走完同行评审+编辑委员会，v2（可能）于次日晨上线；外借展览仍离线展示 v1。");

  // —— 3. 紧急勘误：成分分析坐实支轴为1950年代焊料 → v3 撤回，走紧急流程先止损 ——
  let v3;
  at("2026-04-08T10:00:00+08:00", () => {
    v3 = svc.revise({
      id: V3,
      claim_id: CLAIM,
      status: "withdrawn",
      favored_interpretation: "int-pivot-restoration",
      wording: {
        public:
          "本馆撤回“旱罗盘至迟于十二世纪已在中国使用”的结论：该陶俑支轴磁针经成分分析" +
          "为1950年代修复补配件，不能作为十二世纪旱罗盘实物；现存支轴式磁针装置的文献" +
          "证据不早于十四世纪。",
      },
      basis: [
        "ev-exam-2026-solder",
        "ev-exam-2026-adhesive",
        "ev-citation-shilin-guangji",
        "ev-view-panel-2026",
      ],
      rationale:
        "成分分析确认支轴含二十世纪焊料，旧结论的关键实物证据不成立，须立即撤回并在各渠道止损。",
      created_by: "馆藏器物复核小组",
    });
  });

  // 英文译文必须锁定 v3 才能随官网勘误发布
  svc.translations.register(
    v3,
    "en",
    "The Museum withdraws the claim that the dry-suspension compass was in use in China by the 12th century: the pivot-and-needle assembly on this figurine is a 1950s restoration component.",
    "馆际交流处·柯文（译）"
  );

  at("2026-04-08T11:00:00+08:00", () => {
    const emergencyWeb = svc.openReview({
      process_id: "rp-web-v3-emergency",
      revision_id: V3,
      channel_id: "ch-website",
      mode: "emergency",
    });
    emergencyWeb.approve("duty_curator_approval", "值班馆长·桑雨时", "实物证据不成立，先撤后审");
    svc.publish({
      revision_id: V3,
      channel_id: "ch-website",
      process_id: "rp-web-v3-emergency",
      approver: "值班馆长·桑雨时",
      langs: ["en"],
    });
  });
  say("官网紧急勘误", "值班馆长批准 v3（撤回）即时上线（含锁定 v3 的英文译文），常规流程后补。");

  at("2026-04-09T08:30:00+08:00", () => {
    const emergencySchool = svc.openReview({
      process_id: "rp-school-v3-emergency",
      revision_id: V3,
      channel_id: "ch-school",
      mode: "emergency",
    });
    emergencySchool.approve("editorial_board", "教材编辑委员会·章季兰", "停课勘误，立即换页");
    svc.publish({
      revision_id: V3,
      channel_id: "ch-school",
      process_id: "rp-school-v3-emergency",
      approver: "教材编辑委员会·章季兰",
      label: "勘误：撤回“南宋已使用旱罗盘”的表述。陶俑支轴系1950年代修复补配件，不得再作为教材实例。",
    });
  });
  say("课程紧急勘误", "教材编辑委员会紧急批准 v3，课程同步撤回；外借渠道始终离线，v1 展签未被改动。");

  // —— 4. 紧急之后补走常规学术流程 ——
  at("2026-04-10T14:00:00+08:00", () => {
    const followWeb = svc.openReview({
      process_id: "rp-web-v3-standard",
      revision_id: V3,
      channel_id: "ch-website",
    });
    followWeb.submitReview({
      reviewer: "评审人·苏蘅", interpretation_id: "int-pivot-restoration", vote: "support",
      comment: "焊料成分数据充分，支持撤回。",
    });
    followWeb.markConsidered(["评审人·苏蘅"]);
    followWeb.approve("peer_review", "学术评审召集人·梅守正");
    followWeb.approve("curatorial_committee", "策展委员会·纪衡");
    svc.completeStandardFollowup(V3, "ch-website", "rp-web-v3-standard");

    const followSchool = svc.openReview({
      process_id: "rp-school-v3-standard",
      revision_id: V3,
      channel_id: "ch-school",
    });
    followSchool.submitReview({
      reviewer: "教材审读·傅明", interpretation_id: "int-pivot-restoration", vote: "support",
      comment: "补审：撤回表述与检测结论一致，追认。",
    });
    followSchool.markConsidered(["教材审读·傅明"]);
    followSchool.approve("peer_review", "教材评审召集人·闻子实");
    followSchool.approve("editorial_board", "教材编辑委员会·章季兰");
    svc.completeStandardFollowup(V3, "ch-school", "rp-school-v3-standard");
  });
  say("补审完成", "官网与课程的 v3 紧急勘误均补齐同行评审及各自委员会的追认流程。");

  // —— 5. 外借渠道恢复在线：先直接同步到最新 v3（延迟同步），再处理离线期的旧回执 ——
  let lateReceipt;
  at("2026-04-12T10:30:00+08:00", () => {
    svc.markDelivered("ch-loan", V2); // 离线期积压的 v2 通知此时才送达
    svc.markDelivered("ch-loan", V3);
    const hostProcess = svc.openReview({
      process_id: "rp-loan-v3",
      revision_id: V3,
      channel_id: "ch-loan",
    });
    hostProcess.approve("host_confirmation", "临川县文化馆·借阅负责人（现场签收）");
    svc.publish({
      revision_id: V3,
      channel_id: "ch-loan",
      process_id: "rp-loan-v3",
      approver: "临川县文化馆·借阅负责人",
      kind: "erratum",
      label: "勘误：撤下“十二世纪南宋旱罗盘陶俑”旧展签。该俑支轴磁针为1950年代修复补配件，不能作为十二世纪旱罗盘实物。",
    });
  });
  say("外借延迟同步", "临川县文化馆恢复联络，绕过已过时的 v2，直接确认并换上 v3 勘误展签。");

  let blockedPublishError = null;
  at("2026-04-13T09:00:00+08:00", () => {
    // 对方离线期间（4月9日）签署的其实是 v2 确认单，回执今天才到本馆
    lateReceipt = svc.recordLateReceipt("ch-loan", {
      ack_version: 2,
      ack_revision_id: V2,
      received_by: "临川县文化馆·值班员",
      issued_at: "2026-04-09T15:00:00+08:00",
    });
    // 若有人依据这张迟到确认单补开流程并试图发布 v2，版本护栏会拒绝（v3 已生效）
    try {
      const staleProcess = svc.openReview({
        process_id: "rp-loan-v2-offline-confirmation",
        revision_id: V2,
        channel_id: "ch-loan",
      });
      staleProcess.approve("host_confirmation", "临川县文化馆·值班员");
      svc.publish({
        revision_id: V2,
        channel_id: "ch-loan",
        process_id: "rp-loan-v2-offline-confirmation",
        approver: "临川县文化馆·值班员",
      });
    } catch (error) {
      blockedPublishError = error.message;
    }
  });
  say(
    "迟到回执",
    `v2 离线回执到达，状态=${lateReceipt.status}（当前 v3 不被改动）；尝试按其发布 v2 被拒：“${blockedPublishError}”。`
  );

  // —— 6. 收敛与可追溯性核验 ——
  const convergence = svc.convergence(CLAIM);
  say(
    "收敛核验",
    convergence.各渠道
      .map((r) => `${r.渠道}=v${r.当前版本}/${r.通知状态}`)
      .join("，") + `；全部收敛=${convergence.全部收敛}`
  );

  return { service: svc, log, convergence, lateReceipt, blockedPublishError };
}

// 直接执行时打印可读报告
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("scenario.js");
if (invokedDirectly) {
  const { service, log } = await runScenario();
  console.log(log.join("\n"));

  console.log("\n===== 公众查询（当前表述与证据边界）=====");
  console.log(JSON.stringify(service.publicQuery(CLAIM), null, 2));

  console.log("\n===== 内部还原：2026-04-07 当天各渠道 =====");
  console.log(JSON.stringify(service.internalAsOf(CLAIM, "2026-04-07T12:00:00+08:00"), null, 2));

  console.log("\n===== 内部还原：1997-09-02（旧展签、批准者仍可查）=====");
  console.log(JSON.stringify(service.internalAsOf(CLAIM, "1997-09-02T12:00:00+08:00"), null, 2));

  console.log("\n===== 官网展签追加日志（旧展签从未被覆盖）=====");
  for (const entry of service.channelHistory("ch-website")) {
    console.log(`${entry.published_at}  v${entry.version}  [${entry.kind}]  批准：${entry.approver}`);
    console.log(`  ${entry.label}`);
  }
}
