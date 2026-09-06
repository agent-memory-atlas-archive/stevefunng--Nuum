import assert from "node:assert/strict";
import { test } from "node:test";
import { getLanguage, setLanguage, t } from "./index";
import { messages } from "./messages";

test("language switching keeps product terminology and user content intact", () => {
  try {
    for (const language of ["zh-CN", "en"] as const) {
      setLanguage(language);
      assert.equal(getLanguage(), language);
      assert.equal(t("Agents"), "Nu-nu");
      assert.equal(t("Work Bar"), "work bar");
      const name = "Agents Work Bar {count} 牛来";
      assert.ok(t("Message {name}", { name }).includes(name));
      assert.equal(t("unknown diagnostic /local/path"), "unknown diagnostic /local/path");
    }
    assert.equal(t("Settings"), "Settings");
    setLanguage("zh-CN");
    assert.equal(t("Settings"), "设置");
  } finally { setLanguage("zh-CN"); }
});

test("every interface message has both languages and matching placeholders", () => {
  for (const [key, versions] of Object.entries(messages)) {
    assert.ok(versions.en.trim(), key);
    assert.ok(versions["zh-CN"].trim(), key);
    const tokens = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
    assert.deepEqual(tokens(versions.en), tokens(versions["zh-CN"]), key);
    assert.doesNotMatch(versions.en, /\bAgents?\b|\bWork Bar\b/, key);
  }
});
