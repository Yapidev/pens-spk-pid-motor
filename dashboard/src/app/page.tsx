import { DashboardWorkspace } from "@/components/DashboardWorkspace";

/**
 * Server Component Shell: merender chrome statis (skip-link, layout wrapper, footer)
 * tanpa menyertakan JSX statis ke client bundle (server-serialization & rendering-hoist-jsx).
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--ink-primary)]">
      <a href="#main-content" className="visually-hidden skip-link">
        Langsung ke konten utama
      </a>

      <DashboardWorkspace />

      <footer className="mt-auto border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 font-mono text-[0.6875rem] text-[var(--ink-muted)] lg:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-[var(--ink-primary)]">SIGNAL FLOW:</span>
            <span>[Button, Enc]</span>
            <span aria-hidden="true">→</span>
            <span className="text-[var(--ink-primary)]">[MC: Arduino PID Ts=50ms]</span>
            <span aria-hidden="true">→</span>
            <span>[Driver + Motor DC 24V]</span>
            <span aria-hidden="true">→</span>
            <span className="text-[var(--accent-rpm)]">[INT0 Encoder RPM]</span>
            <span aria-hidden="true" className="mx-1 text-[var(--border-control)]">|</span>
            <span className="text-[var(--accent-ok)]">MC ⇄ Laptop ⇄ Dashboard [R/W 115200]</span>
          </div>
          <div>PENS · Sistem Pengaturan Komputer</div>
        </div>
      </footer>
    </div>
  );
}
