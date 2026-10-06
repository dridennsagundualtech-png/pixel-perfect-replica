import { Link } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { useCampaigns } from "@/lib/campaign/campaign-store";

/** Always-visible Normal Mode / Campaign Mode indicator. */
export function CampaignModeBanner() {
  const { active } = useCampaigns();
  if (!active) {
    return (
      <div className="border-b border-border bg-muted/30">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-1.5 text-xs sm:px-6">
          <span className="rounded-full border border-border px-2 py-0.5 font-semibold tracking-wide text-muted-foreground">
            NORMAL MODE
          </span>
          <span className="text-muted-foreground">ClipPilot is working normally.</span>
          <Link to="/campaigns" className="ml-auto text-primary hover:underline">
            Campaign Mode
          </Link>
        </div>
      </div>
    );
  }
  const reqs = active.requirements.filter((r) => r.active);
  const n = (t: string) => reqs.filter((r) => r.type === t).length;
  return (
    <div className="border-b border-primary/40 bg-primary/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs sm:px-6">
        <span className="flex items-center gap-1.5 rounded-full bg-primary px-2 py-0.5 font-semibold tracking-wide text-primary-foreground">
          <Megaphone className="size-3" /> CAMPAIGN MODE
        </span>
        <span className="text-sm font-semibold">{active.name}</span>
        <span className="text-muted-foreground">
          {n("required")} requirements · {n("prohibited")} restrictions · {n("recommended")}{" "}
          recommendations · {n("review")} to review
        </span>
        <Link to="/campaigns" className="ml-auto text-primary hover:underline">
          Manage campaign
        </Link>
      </div>
    </div>
  );
}
