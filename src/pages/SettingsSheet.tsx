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
import { t } from '../i18n';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { settings } = app;

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet frosted" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title title-large">{t('settings.title')}</div>

        <div className="body-medium" style={{ color: 'var(--on-surface-variant)', marginBottom: 16 }}>
          {t('settings.guestNotice')}
        </div>

        <SettingsRow title={t('settings.theme')}>
          <div className="chip-row">
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                className={`sleep-chip label-medium${settings.themeMode === mode ? ' sleep-chip-active' : ''}`}
                onClick={() => actions.updateSettings({ themeMode: mode })}
              >
                {t(`theme.${mode}`)}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow title={t('settings.syncedLyrics')}>
          <Toggle
            checked={settings.syncedLyrics}
            onChange={(checked) => actions.updateSettings({ syncedLyrics: checked })}
          />
        </SettingsRow>

        <SettingsRow title={t('settings.autoPlay')}>
          <Toggle
            checked={settings.autoplay}
            onChange={(checked) => actions.updateSettings({ autoplay: checked })}
          />
        </SettingsRow>

        <SettingsRow title={t('settings.crossfade')}>
          <div className="chip-row">
            {[0, 2, 4, 6, 8].map((seconds) => (
              <button
                key={seconds}
                className={`sleep-chip label-medium${settings.crossfadeSeconds === seconds ? ' sleep-chip-active' : ''}`}
                onClick={() => actions.updateSettings({ crossfadeSeconds: seconds })}
              >
                {seconds === 0 ? t('crossfade.off') : t('crossfade.s', { s: seconds })}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow title={t('settings.dataSaver')}>
          <Toggle
            checked={settings.dataSaver}
            onChange={(checked) => actions.updateSettings({ dataSaver: checked })}
          />
        </SettingsRow>

        <SettingsRow title={t('settings.language')}>
          <div className="chip-row">
            {(['en', 'ja'] as const).map((lang) => (
              <button
                key={lang}
                className={`sleep-chip label-medium${settings.language === lang ? ' sleep-chip-active' : ''}`}
                onClick={() => actions.updateSettings({ language: lang })}
              >
                {t(`language.${lang}`)}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SourcesSection />

        <div className="settings-footer label-small" style={{ color: 'var(--on-surface-variant)' }}>
          {t('settings.footer')}
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
    actions.showToast(ok ? t('sources.upToast', { name: source.name }) : t('sources.downToast', { name: source.name }));
  };

  const add = () => {
    const clean = url.trim().replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(clean);
    } catch {
      actions.showToast(t('sources.enterUrl'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      actions.showToast(t('sources.onlyHttps'));
      return;
    }
    if (sources.some((s) => s.baseUrl === clean)) {
      actions.showToast(t('sources.duplicate'));
      return;
    }
    const source: StreamSource = { name: parsed.host, baseUrl: clean, kind, custom: true };
    actions.updateSettings({ sources: [source, ...sources] });
    actions.showToast(t('sources.addedToast', { host: parsed.host }));
    setUrl('');
    setAdding(false);
  };

  return (
    <div className="sources-section">
      <div className="settings-row" style={{ marginBottom: 4 }}>
        <span className="body-large">{t('sources.title')}</span>
        <button className="text-button label-medium" onClick={() => setAdding(true)}>
          {t('sources.add')}
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
            {t('sources.save')}
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
              {source.custom ? ` ${t('sources.customTag')}` : ''}
            </div>
          </div>
          <button className="text-button label-medium" onClick={() => void check(source)}>
            {checking === source.baseUrl ? '…' : t('sources.test')}
          </button>
          {source.custom && (
            <button
              className="text-button label-medium"
              onClick={() =>
                actions.updateSettings({ sources: sources.filter((s) => s.baseUrl !== source.baseUrl) })
              }
            >
              {t('sources.remove')}
            </button>
          )}
        </div>
      ))}
      <div className="label-small" style={{ color: 'var(--on-surface-variant)', marginTop: 4 }}>
        {t('sources.builtIns')}{BUILTIN_SOURCES.map((s) => s.name).join(', ')}
      </div>
    </div>
  );
}
