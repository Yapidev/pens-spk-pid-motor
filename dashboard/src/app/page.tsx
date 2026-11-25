import { DashboardWorkspace } from "@/components/DashboardWorkspace";

/**
 * Server Component Shell: merender full-height instrumentation viewport
 * tanpa footer dekoratif atau chrome berlebihan.
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--ink-primary)] xl:h-screen xl:overflow-hidden">
      <a href="#main-content" className="visually-hidden skip-link">
        Langsung ke konten utama
      </a>

      <DashboardWorkspace />
    </div>
  );
}
