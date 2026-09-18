import { AgentPanel } from "../panels/AgentPanel.tsx";
import { ChroniclePanel } from "../panels/ChroniclePanel.tsx";
import { GodPanel } from "../panels/GodPanel.tsx";
import { MetricsPanel } from "../panels/MetricsPanel.tsx";
import { SocietyPanel } from "../panels/SocietyPanel.tsx";
import { type Tab, useUiStore } from "../store/uiStore.ts";

const TABS: Array<[Tab, string]> = [
  ["ser", "Ser"],
  ["sociedad", "Sociedad"],
  ["cronica", "Crónica"],
  ["metricas", "Métricas"],
  ["dios", "Dios"],
];

export function RightPanel() {
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);
  const open = useUiStore((s) => s.panelOpen);
  const togglePanel = useUiStore((s) => s.togglePanel);

  if (!open) {
    return (
      <aside className="panel panel--closed">
        <button type="button" className="panel__reopen" onClick={togglePanel} title="mostrar panel" aria-label="mostrar panel">
          ⟨
        </button>
      </aside>
    );
  }
  return (
    <aside className="panel" data-testid="panel">
      <nav className="panel__tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? " tab--active" : ""}`} onClick={() => setTab(key)} data-testid={`tab-${key}`}>
            {label}
          </button>
        ))}
        <button type="button" className="tab tab--close" onClick={togglePanel} title="ocultar panel" aria-label="ocultar panel">
          ⟩
        </button>
      </nav>
      <div className="panel__body" key={tab}>
        {tab === "ser" && <AgentPanel />}
        {tab === "sociedad" && <SocietyPanel />}
        {tab === "cronica" && <ChroniclePanel />}
        {tab === "metricas" && <MetricsPanel />}
        {tab === "dios" && <GodPanel />}
      </div>
    </aside>
  );
}
