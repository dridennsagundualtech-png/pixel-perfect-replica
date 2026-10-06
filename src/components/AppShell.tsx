import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FolderOpen,
  LayoutTemplate,
  Megaphone,
  Settings,
  Scissors,
} from "lucide-react";
import { CampaignModeBanner } from "@/components/campaign/CampaignModeBanner";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/templates", label: "Templates", icon: LayoutTemplate },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid-backdrop">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Scissors className="size-4" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">ClipPilot</span>
          </Link>

          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <CampaignModeBanner />
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        ClipPilot — UI foundation. Video processing, transcription and AI analysis are not connected
        yet.
      </footer>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
