import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../src/lib/creator-presets";
import {
  activateCampaign,
  createCampaign,
  deactivateCampaign,
  deleteCampaign,
  duplicateCampaign,
  exportCampaignJson,
  getActiveCampaign,
  importCampaignJson,
  listCampaigns,
  makeRequirement,
  updateCampaign,
} from "../src/lib/campaign/campaign-store";
import {
  classifyType,
  detectAiConflict,
  parseAiRequirements,
  parseBrief,
  parseBriefLocal,
  reconcileType,
} from "../src/lib/campaign/brief-parser";
import {
  evaluateClipForCampaign,
  parseAiAssessment,
  type ClipCampaignContext,
} from "../src/lib/campaign/compliance";
import { isFabricatedQuote, localHooks, parseAiHooks, suggestHooks } from "../src/lib/campaign/campaign-hooks";
import type { Campaign } from "../src/lib/campaign/types";

const mem = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

const BRIEF = `Every video must include #GameX in the caption.
Tag @gamexofficial in the description.
The hook must mention GameX within the first 3 seconds.
Clips should ideally be under 45 seconds.
Do not use copyrighted music.
Prioritize funny reactions.`;

function campaignWith(reqs: Campaign["requirements"], extra: Partial<Campaign> = {}): Campaign {
  return {
    id: "c1",
    name: "Test",
    brief: "",
    approvedSources: [],
    requirements: reqs,
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

const ctx = (over: Partial<ClipCampaignContext> = {}): ClipCampaignContext => ({
  startSec: 10,
  endSec: 40,
  transcriptText: "GameX is wild, look at that funny reaction",
  segments: [
    {
      id: "s",
      startSec: 10,
      endSec: 14,
      text: "GameX is wild",
      words: [
        { text: "GameX", startSec: 10.5, endSec: 11 },
        { text: "is", startSec: 11, endSec: 11.2 },
        { text: "wild", startSec: 11.2, endSec: 11.6 },
      ],
    },
  ],
  title: "t",
  description: "Tag @gamexofficial",
  hashtags: "#gamex",
  aspect: "9:16",
  captionsEnabled: true,
  ...over,
});

describe("campaign store", () => {
  it("creates, activates, switches, deactivates", () => {
    const st = mem();
    const a = createCampaign({ name: "A" }, st);
    const b = createCampaign({ name: "B" }, st);
    expect(getActiveCampaign(st)).toBeNull();
    activateCampaign(a.id, st);
    expect(getActiveCampaign(st)?.name).toBe("A");
    activateCampaign(b.id, st);
    expect(getActiveCampaign(st)?.name).toBe("B");
    deactivateCampaign(st);
    expect(getActiveCampaign(st)).toBeNull();
  });
  it("prevents duplicate names and duplicates with a new name", () => {
    const st = mem();
    const a = createCampaign({ name: "Gaming" }, st);
    expect(() => createCampaign({ name: "gaming" }, st)).toThrow(/already exists/);
    const copy = duplicateCampaign(a.id, st);
    expect(copy.name).toBe("Gaming (copy)");
    expect(listCampaigns(st)).toHaveLength(2);
  });
  it("isolates requirements between campaigns", () => {
    const st = mem();
    const mma = createCampaign({ name: "MMA", requirements: [makeRequirement("Mention fighter names")] }, st);
    const game = createCampaign({ name: "Gaming" }, st);
    activateCampaign(mma.id, st);
    activateCampaign(game.id, st);
    expect(getActiveCampaign(st)!.requirements).toHaveLength(0);
  });
  it("deleting the active campaign returns to normal mode", () => {
    const st = mem();
    const a = createCampaign({ name: "A" }, st);
    activateCampaign(a.id, st);
    deleteCampaign(a.id, st);
    expect(getActiveCampaign(st)).toBeNull();
  });
  it("imports/exports JSON and renames clashes", () => {
    const st = mem();
    const a = createCampaign({ name: "A", requirements: parseBriefLocal(BRIEF) }, st);
    const json = exportCampaignJson(a);
    const b = importCampaignJson(json, st);
    expect(b.name).toBe("A 2");
    expect(b.requirements).toHaveLength(a.requirements.length);
    expect(() => importCampaignJson("{bad", st)).toThrow();
  });
  it("keeps user-edited requirements", () => {
    const st = mem();
    const a = createCampaign({ name: "A", requirements: parseBriefLocal(BRIEF) }, st);
    const r = { ...a.requirements[0]!, type: "recommended" as const, origin: "user" as const };
    const u = updateCampaign(a.id, { requirements: [r] }, st);
    expect(u.requirements[0]!.type).toBe("recommended");
    expect(u.requirements[0]!.origin).toBe("user");
  });
});

describe("brief parser", () => {
  const reqs = parseBriefLocal(BRIEF);
  it("returns structured requirements with types and checks", () => {
    expect(reqs).toHaveLength(6);
    for (const r of reqs) {
      expect(r.text.length).toBeGreaterThan(3);
      expect(r.active).toBe(true);
    }
  });
  it("classifies required / recommended / prohibited", () => {
    expect(reqs[0]!.type).toBe("required");
    expect(reqs[0]!.check).toEqual({ kind: "hashtag", values: ["#gamex"] });
    expect(reqs[1]!.check?.kind).toBe("account");
    expect(reqs[2]!.check).toMatchObject({ kind: "hook-time", seconds: 3, values: ["GameX"] });
    expect(reqs[3]!.type).toBe("recommended");
    expect(reqs[3]!.check).toMatchObject({ kind: "max-duration", seconds: 45 });
    expect(reqs[4]!.type).toBe("prohibited");
    expect(classifyType("Something vague about vibes")).toBe("review");
  });
  it("never lets AI upgrade a recommendation to mandatory", () => {
    expect(reconcileType("required", "Clips should be short")).toBe("recommended");
    const ai = parseAiRequirements(
      '{"requirements":[{"category":"editing","type":"required","text":"Ideally keep it under 30 seconds"}]}',
    );
    expect(ai![0]!.type).toBe("recommended");
    expect(ai![0]!.origin).toBe("ai");
  });
  it("Ollama failure / malformed / unavailable fall back to local", async () => {
    const off = await parseBrief(BRIEF);
    expect(off.source).toBe("local");
    const fail = await parseBrief(BRIEF, [], {
      ollama: { enabled: true, model: "m", baseUrl: "x" },
      generate: () => Promise.reject(new Error("down")),
    });
    expect(fail.source).toBe("local");
    expect(fail.warning).toMatch(/unavailable/);
    const bad = await parseBrief(BRIEF, [], {
      ollama: { enabled: true, model: "m", baseUrl: "x" },
      generate: () => Promise.resolve("not json"),
    });
    expect(bad.source).toBe("local");
    expect(bad.requirements).toHaveLength(6);
  });
  it("empty brief is handled", async () => {
    const r = await parseBrief("   ");
    expect(r.requirements).toEqual([]);
  });
  it("flags AI-prohibiting campaigns", () => {
    expect(detectAiConflict("No AI clipping tools allowed.")).toBe(true);
    expect(detectAiConflict("Use official footage.")).toBe(false);
  });
});

describe("compliance", () => {
  const camp = campaignWith(parseBriefLocal(BRIEF));
  it("missing requirements → no fit, PASS with nothing to check", () => {
    const e = evaluateClipForCampaign(campaignWith([]), ctx())!;
    expect(e.fit).toBeNull();
    expect(e.status).toBe("PASS");
    expect(evaluateClipForCampaign(null, ctx())).toBeNull();
  });
  it("required hashtag + phrase + hook timing detected", () => {
    const e = evaluateClipForCampaign(camp, ctx())!;
    const byKind = (k: string) => e.outcomes.find((o) => o.requirement.check?.kind === k)!;
    expect(byKind("hashtag").result).toBe("pass");
    expect(byKind("account").result).toBe("pass");
    expect(byKind("hook-time").result).toBe("pass");
    expect(byKind("max-duration").result).toBe("pass");
  });
  it("REVIEW when something can't be verified (copyright music)", () => {
    const e = evaluateClipForCampaign(camp, ctx())!;
    expect(e.status).toBe("REVIEW");
    expect(e.fit).toBeGreaterThan(50);
  });
  it("FAIL when a mandatory check is violated, with a fix offered", () => {
    const e = evaluateClipForCampaign(camp, ctx({ hashtags: "" }))!;
    expect(e.status).toBe("FAIL");
    const o = e.outcomes.find((x) => x.requirement.check?.kind === "hashtag")!;
    expect(o.fix?.hashtags).toEqual(["#gamex"]);
  });
  it("hook outside the window fails", () => {
    const late = ctx({
      segments: [
        { id: "s", startSec: 10, endSec: 20, text: "x GameX", words: [{ text: "GameX", startSec: 15, endSec: 15.5 }] },
      ],
    });
    const e = evaluateClipForCampaign(camp, late)!;
    expect(e.outcomes.find((o) => o.requirement.check?.kind === "hook-time")!.result).toBe("fail");
  });
  it("PASS when all mandatory checks are verified", () => {
    const c = campaignWith(parseBriefLocal("Every video must include #GameX.\nClips should be under 45 seconds."));
    const e = evaluateClipForCampaign(c, ctx())!;
    expect(e.status).toBe("PASS");
    expect(e.fit).toBe(100);
  });
  it("recommendations never cause FAIL", () => {
    const c = campaignWith(parseBriefLocal("Clips should be under 10 seconds."));
    const e = evaluateClipForCampaign(c, ctx())!;
    expect(e.status).toBe("PASS");
    expect(e.fit).toBe(0);
  });
  it("unknown source stays REVIEW, never approved", () => {
    const c = campaignWith(parseBriefLocal("Only use approved official footage."), {
      approvedSources: ["match1.mp4"],
    });
    expect(evaluateClipForCampaign(c, ctx({ sourceFileName: "other.mp4" }))!.status).toBe("REVIEW");
    expect(evaluateClipForCampaign(c, ctx({ sourceFileName: "MATCH1.mp4" }))!.status).toBe("PASS");
  });
  it("validates AI assessments and never turns AI 'met' into PASS for mandatory rules", () => {
    const c = campaignWith([makeRequirement("Must show a funny reaction", "content", "required", "ai")]);
    const id = c.requirements[0]!.id;
    expect(parseAiAssessment("nope", c)).toBeNull();
    const ai = parseAiAssessment(`{"fit":90,"met":["${id}","bogus"],"violated":[]}`, c)!;
    expect(ai.met).toEqual([id]);
    expect(evaluateClipForCampaign(c, ctx({ ai }))!.status).toBe("REVIEW");
  });
});

describe("no fabricated quotes", () => {
  const t = "this is the craziest clutch I have ever seen";
  it("rejects invented quotes and attributions", () => {
    expect(isFabricatedQuote('PLAYER said: "I knew I would win"', t)).toBe(true);
    expect(isFabricatedQuote("He said: I knew it", t)).toBe(true);
    expect(isFabricatedQuote('"the craziest clutch"', t)).toBe(false);
    expect(isFabricatedQuote("This might be the craziest clutch of the match", t)).toBe(false);
  });
  it("local and AI hooks never contain fabricated quotes", async () => {
    for (const h of localHooks(null, t)) expect(isFabricatedQuote(h, t)).toBe(false);
    expect(parseAiHooks('{"hooks":["He said: \\"I am the best\\"","Watch this clutch"]}', t)).toEqual([
      "Watch this clutch",
    ]);
    const r = await suggestHooks(null, t, {
      ollama: { enabled: true, model: "m", baseUrl: "x" },
      generate: () => Promise.reject(new Error("down")),
    });
    expect(r.source).toBe("local");
    expect(r.hooks.length).toBeGreaterThan(0);
  });
});
