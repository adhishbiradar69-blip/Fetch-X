import { Monitor, Moon, Sun, Zap, Gauge, Type, Rows3, PanelLeftClose, RotateCcw, Settings2 } from 'lucide-react';
import { Modal } from './ui.jsx';
import { usePrefs } from './ThemeProvider.jsx';

/* ─────────────────────────────────────────────────────────────────────────────
   Profile → Settings — user GUI customisation.

   Comfort/accessibility controls only: colour-mode, motion level, text size,
   density and the sidebar default. Every option renders with the existing
   FETCH-X tokens/classes, so the platform theme itself is untouched.
   ──────────────────────────────────────────────────────────────────────────── */

function Seg({ options, value, onChange, name }) {
  return (
    <div className="fx-seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`fx-seg-btn ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ icon: Icon, title, desc, children }) {
  return (
    <div className="fx-set-row">
      <div className="fx-set-info">
        <div className="fx-set-title"><Icon size={15} strokeWidth={2.2} /> {title}</div>
        <p className="fx-set-desc">{desc}</p>
      </div>
      <div className="fx-set-control">{children}</div>
    </div>
  );
}

export default function SettingsModal({ open, onClose }) {
  const { prefs, setPref, reset } = usePrefs() || {};
  if (!prefs) return null;

  return (
    <Modal open={open} onClose={onClose} title="Profile & Settings" wide>
      <div className="fx-settings">
        <div className="fx-settings-head">
          <span className="fx-settings-badge"><Settings2 size={14} /> Applies instantly · saved on this device</span>
        </div>

        <Row icon={Monitor} title="Appearance" desc="Match the app to your environment — System follows your device setting.">
          <Seg
            name="Appearance"
            value={prefs.mode}
            onChange={(v) => setPref('mode', v)}
            options={[
              { value: 'system', label: 'System', icon: <Monitor size={13} /> },
              { value: 'light', label: 'Light', icon: <Sun size={13} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
            ]}
          />
        </Row>

        <Row icon={Zap} title="Motion & animation" desc="Reduced calms transitions; Off disables them (also honoured automatically when your OS asks for reduced motion).">
          <Seg
            name="Motion"
            value={prefs.motion}
            onChange={(v) => setPref('motion', v)}
            options={[
              { value: 'full', label: 'Full', icon: <Zap size={13} /> },
              { value: 'reduced', label: 'Reduced', icon: <Gauge size={13} /> },
              { value: 'off', label: 'Off', icon: <span style={{ fontSize: 11, fontWeight: 800 }}>Ø</span> },
            ]}
          />
        </Row>

        <Row icon={Type} title="Text size" desc="Scale the whole interface for comfortable reading.">
          <Seg
            name="Text size"
            value={prefs.textScale}
            onChange={(v) => setPref('textScale', v)}
            options={[
              { value: 'sm', label: 'A−', icon: null },
              { value: 'md', label: 'Default', icon: null },
              { value: 'lg', label: 'A+', icon: null },
            ]}
          />
        </Row>

        <Row icon={Rows3} title="Density" desc="Compact tightens spacing so more fits on screen — handy on smaller displays.">
          <Seg
            name="Density"
            value={prefs.density}
            onChange={(v) => setPref('density', v)}
            options={[
              { value: 'cozy', label: 'Cozy', icon: null },
              { value: 'compact', label: 'Compact', icon: null },
            ]}
          />
        </Row>

        <Row icon={PanelLeftClose} title="Sidebar" desc="Start with the sidebar collapsed to maximise table space.">
          <Seg
            name="Sidebar"
            value={prefs.sidebarCollapsed ? 'collapsed' : 'expanded'}
            onChange={(v) => setPref('sidebarCollapsed', v === 'collapsed')}
            options={[
              { value: 'expanded', label: 'Expanded', icon: null },
              { value: 'collapsed', label: 'Collapsed', icon: null },
            ]}
          />
        </Row>

        <div className="fx-settings-foot">
          <button type="button" className="fx-reset-btn" onClick={reset}>
            <RotateCcw size={13} strokeWidth={2.2} /> Reset to defaults
          </button>
        </div>
      </div>
    </Modal>
  );
}
