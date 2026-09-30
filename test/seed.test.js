import assert from "node:assert/strict";
import test from "node:test";

import { loadSeed } from "../src/seed.js";

test("领域样例通过基础校验且标识稳定", async () => {
  const data = await loadSeed();
  assert.ok(data.project);
  for (const record of data.evidence) assert.ok(record.id);
  // 五类证据齐备且分储
  const kinds = new Set(data.evidence.map((r) => r.kind));
  for (const kind of [
    "artifact_feature",
    "excavation_context",
    "examination_record",
    "literature_citation",
    "researcher_view",
  ]) {
    assert.ok(kinds.has(kind), `缺少证据类别：${kind}`);
  }
  // 竞争解释并存
  assert.ok(data.claims.every((c) => c.interpretations.length >= 2));
});
