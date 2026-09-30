// 译文锁：译文必须锁定同一事实版本（修订标识 + 版本号）。
// 渠道发布时只能附带与所发修订完全一致的译文；为旧修订准备的译文不得用于新修订。

export class TranslationRegistry {
  constructor() {
    this._byKey = new Map(); // revision_id -> lang -> 冻结译文
  }

  register(revision, lang, text, translator) {
    if (!text?.trim()) throw new Error("译文不能为空");
    if (!translator) throw new Error("译文必须记录译者");
    const key = revision.id;
    if (!this._byKey.has(key)) this._byKey.set(key, new Map());
    const bucket = this._byKey.get(key);
    if (bucket.has(lang)) throw new Error(`${revision.id} 的 ${lang} 译文已锁定，禁止覆盖`);
    const entry = Object.freeze({
      revision_id: revision.id,
      version: revision.version,
      lang,
      text,
      translator,
    });
    bucket.set(lang, entry);
    return entry;
  }

  // 发布门禁：校验某修订的某语种译文确实锁定在该修订上
  lockedTranslations(revision, langs) {
    const bucket = this._byKey.get(revision.id);
    const out = {};
    for (const lang of langs) {
      const entry = bucket?.get(lang);
      if (!entry) throw new Error(`缺少锁定到 ${revision.id} 的 ${lang} 译文`);
      if (entry.version !== revision.version) {
        throw new Error(`译文版本 ${entry.version} 与事实版本 ${revision.version} 不一致`);
      }
      out[lang] = entry.text;
    }
    return out;
  }

  forRevision(revisionId) {
    return [...(this._byKey.get(revisionId)?.values() ?? [])];
  }
}
