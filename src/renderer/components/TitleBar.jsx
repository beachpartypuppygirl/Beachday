import { useEffect, useState } from 'react';

const MENUS = ['File', 'Edit', 'View', 'Playback', 'Playlists', 'Options'];

/**
 * Custom window chrome. The BrowserWindow is frameless, so this bar provides
 * both the drag region (-webkit-app-region: drag in app.css) and the
 * minimize / maximize / close controls.
 *
 * The menu items are inert in Phase 1 — they mark where the real menus land.
 */
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // The window can also be maximized by the OS (double-click, tiling,
    // keyboard shortcut), so take the initial value and then subscribe.
    window.beachday.window.isMaximized().then(setIsMaximized);
    return window.beachday.window.onMaximizedChanged(setIsMaximized);
  }, []);

  return (
    <header className="titlebar">
      <span className="titlebar__brand">BEACHDAY</span>

      <nav className="titlebar__menu">
        {MENUS.map((label) => (
          <button key={label} className="titlebar__menu-item" type="button">
            {label}
          </button>
        ))}
      </nav>

      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
        <button
          className="titlebar__control"
          type="button"
          aria-label="Minimize"
          onClick={() => window.beachday.window.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          className="titlebar__control"
          type="button"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() => window.beachday.window.toggleMaximize()}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0" y="2.5" width="7.5" height="7.5" fill="none" stroke="currentColor" />
              <path d="M2.5 2.5V0H10v7.5H7.5" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>

        <button
          className="titlebar__control titlebar__control--close"
          type="button"
          aria-label="Close"
          onClick={() => window.beachday.window.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  );
}
