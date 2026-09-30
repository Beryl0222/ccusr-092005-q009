import { readFile } from "node:fs/promises";

import { EVIDENCE_KINDS } from "./domain/evidence-store.js";
import { STATUS } from "./domain/revision-ledger.js";

// 载入并基础校验领域资料：证据五类分储、主张与竞争解释、修订、渠道与历史展签。
export async function loadSeed(path = "fixtures/seed.json") {
  const data = JSON.parse(await readFile(path, "utf8"));
  if (!data.project) throw new Error("领域样例缺少项目名称");
  for (const arrayField of ["evidence", "claims", "conclusions", "channels", "publications"]) {
    if (!Array.isArray(data[arrayField])) throw new Error(`领域样例缺少数组字段：${arrayField}`);
  }
  const ids = new Set();
  const checkId = (record) => {
    if (!record.id) throw new Error("记录缺少稳定标识");
    if (ids.has(record.id)) throw new Error(`标识重复：${record.id}`);
    ids.add(record.id);
  };
  for (const record of data.evidence) {
    checkId(record);
    if (!EVIDENCE_KINDS[record.kind]) throw new Error(`证据类别非法：${record.id}`);
  }
  for (const claim of data.claims) {
    checkId(claim);
    if (!Array.isArray(claim.interpretations) || claim.interpretations.length < 2) {
      throw new Error(`主张 ${claim.id} 必须允许竞争解释并存（至少两种解释）`);
    }
    claim.interpretations.forEach(checkId);
  }
  const claimIds = new Set(data.claims.map((c) => c.id));
  for (const revision of data.conclusions) {
    checkId(revision);
    if (!STATUS[revision.status.toUpperCase()]) throw new Error(`修订状态非法：${revision.id}`);
    if (!claimIds.has(revision.claim_id)) throw new Error(`修订引用未知主张：${revision.id}`);
  }
  return data;
}
