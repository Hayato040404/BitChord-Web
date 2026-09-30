/**
 * BitChord web — settings.
 *
 * Ported from SettingsSheet (web-relevant subset): theme mode, crossfade,
 * synced lyrics, autoplay, and the pluggable sources manager with health
 * checks. Guest notice stands in for the account section.
 */

import { useState } from 'react';
import { actions, useApp } from '../state/store';
import { BUILTIN_SOURCES, checkSource } from '../api/sources';
import type { StreamSource } from '../api/sources';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { settings } = app;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title title-large">Settings</div>

        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 16 }}>
          Guest mode — likes, playlists and history are stored on this device.
        </div>

        <SettingsRow title="Theme">
          <div className="chip-row">
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                className={`sleep-chip label-medium${settings.themeMode === mode ? ' sleep-chip-active' : ''}`}
                onClick={() => actions.updateSettings({ themeMode: mode })}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow title={`Crossfade — ${settings.crossfadeSeconds}s`}>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={settings.crossfadeSeconds}
            onChange={(e) => actions.updateSettings({ crossfadeSeconds: Number(e.target.value) })}
            className="range-input"
          />
        </SettingsRow>

        <SettingsRow title="Synced lyrics">
          <Toggle
            checked={settings.syncedLyrics}
            onChange={(checked) => actions.updateSettings({ syncedLyrics: checked })}
          />
        </SettingsRow>

        <SettingsRow title="AutoPlay (radio after queue ends)">
          <Toggle
            checked={settings.autoplay}
            onChange={(checked) => actions.updateSettings({ autoplay: checked })}
          />
        </SettingsRow>

        <SettingsRow title="Data saver (prefer lowest bitrate)">
          <Toggle
            checked={settings.dataSaver}
            onChange={(checked) => actions.updateSettings({ dataSaver: checked })}
          />
        </SettingsRow>

        <SourcesSection />

        <div className="settings-footer label-small" style={{ color: 'var(--on-surface-variant)' }}>
          BitChord web — GPL v3. Not affiliated with YouTube or Google.
        </div>
      </div>
    </div>
  );
}

function SettingsRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="body-large">{title}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle${checked ? ' toggle-on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function SourcesSection() {
  const app = useApp();
  const [checking, setChecking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'piped' | 'invidious'>('piped');

  const sources = app.settings.sources;

  const check = async (source: StreamSource) => {
    setChecking(source.baseUrl);
    const ok = await checkSource(source);
    setChecking(null);
    actions.showToast(ok ? `${source.name} is up` : `${source.name} is down`);
  };

  const add = () => {
    const clean = url.trim().replace(/\/$/, '');
    if (!clean.startsWith('http')) return;
    const source: StreamSource = { name: clean.replace(/^https?:\/\//, ''), baseUrl: clean, kind, custom: true };
    actions.updateSettings({ sources: [source, ...sources] });
    setUrl('');
    setAdding(false);
  };

  return (
    <div className="sources-section">
      <div className="settings-row" style={{ marginBottom: 4 }}>
        <span className="body-large">Sources</span>
        <button className="text-button label-medium" onClick={() => setAdding(true)}>
          Add
        </button>
      </div>
      {adding && (
        <div className="source-add">
          <input
            className="text-input body-medium"
            placeholder="https://pipedapi.example.org"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="chip-row">
            {(['piped', 'invidious'] as const).map((k) => (
              <button
                key={k}
                className={`sleep-chip label-medium${kind === k ? ' sleep-chip-active' : ''}`}
                onClick={() => setKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <button className="text-button label-medium" onClick={add}>
            Save source
          </button>
        </div>
      )}
      {sources.map((source) => (
        <div key={source.baseUrl} className="source-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="body-medium" style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {source.name}
            </div>
            <div className="label-small" style={{ color: 'var(--on-surface-variant)' }}>
              {source.kind}
              {source.custom ? ' · custom' : ''}
            </div>
          </div>
          <button className="text-button label-medium" onClick={() => void check(source)}>
            {checking === source.baseUrl ? '…' : 'Test'}
          </button>
          {source.custom && (
            <button
              className="text-button label-medium"
              onClick={() =>
                actions.updateSettings({ sources: sources.filter((s) => s.baseUrl !== source.baseUrl) })
              }
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="label-small" style={{ color: 'var(--on-surface-variant)', marginTop: 4 }}>
        Built-ins: {BUILTIN_SOURCES.map((s) => s.name).join(', ')}
      </div>
    </div>
  );
}
