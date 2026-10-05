/**
 * Universal Campaign Mode types. Campaigns are user-defined data — there is
 * no campaign-specific code anywhere; every check is generated from these.
 */

export type RequirementCategory =
  | "content"
  | "priority"
  | "hook"
  | "branding"
  | "post"
  | "source"
  | "language"
  | "prohibited"
  | "editing"
  | "posting"
  | "other";

export type RequirementType = "required" | "recommended" | "prohibited" | "review";
export type DetectionMethod = "automatic" | "ai" | "manual";

export type CheckKind =
  | "phrase"
  | "hashtag"
  | "account"
  | "hook-time"
  | "min-duration"
  | "max-duration"
  | "aspect"
  | "language"
  | "source"
  | "captions"
  | "forbidden-words";

export interface RequirementCheck {
  kind: CheckKind;
  /** Words / hashtags / handles / phrases / aspect ("9:16") / language name. */
  values?: string[] | undefined;
  seconds?: number | undefined;
}

export interface CampaignRequirement {
  id: string;
  category: RequirementCategory;
  text: string;
  type: RequirementType;
  method: DetectionMethod;
  active: boolean;
  check?: RequirementCheck | undefined;
  origin: "local" | "ai" | "user";
}

export interface Campaign {
  id: string;
  name: string;
  description?: string | undefined;
  brief: string;
  url?: string | undefined;
  /** Approved source filenames (case-insensitive exact match). */
  approvedSources: string[];
  notes?: string | undefined;
  requirements: CampaignRequirement[];
  createdAt: string;
  updatedAt: string;
}

export const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  content: "Content",
  priority: "Priority moments",
  hook: "Hook",
  branding: "Branding",
  post: "Post / caption",
  source: "Source",
  language: "Language",
  prohibited: "Prohibited content",
  editing: "Editing",
  posting: "Posting",
  other: "Other",
};

export const TYPE_LABELS: Record<RequirementType, string> = {
  required: "Required",
  recommended: "Recommended",
  prohibited: "Prohibited",
  review: "Review",
};

export const METHOD_LABELS: Record<DetectionMethod, string> = {
  automatic: "Automatic",
  ai: "AI",
  manual: "Manual",
};

/** Normal ClipPilot behaviour shown separately from campaign rules. */
export const CLIPPILOT_DEFAULTS = [
  "Detect strong moments and rank Engagement Potential.",
  "Apply your Rule Mode hard filters (length, silence, filler words).",
  "Captions use real Whisper word timing only.",
  "Your video stays on this computer.",
];
