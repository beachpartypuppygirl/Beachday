import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MENUS, getContext, resolveItem } from '../menus/commands.js';
import { player } from '../audio/engine.js';
import * as store from '../store/playlists.js';
import * as ui from '../store/ui.js';

/**
 * The title bar's menus, drawn by hand because the window is frameless
 * (MENUS.md). Classic desktop behaviour: click a label to open its menu; while
 * one is open, hovering another label switches to it; Escape, a click
 * elsewhere, or the window losing focus closes it.
 */
export default function MenuBar() {
  const [openIndex, setOpenIndex] = useState(null);
  const barRef = useRef(null);

  // Labels and enabled states depend on all three stores.
  useSyncExternalStore(store.subscribe, store.getState);
  useSyncExternalStore(player.subscribe, player.getState);
  ui.useUi();
  const ctx = getContext();

  useEffect(() => {
    ui.refreshRecent();
  }, []);

  useEffect(() => {
    if (openIndex === null) return;
    const onPointerDown = (event) => {
      if (!barRef.current.contains(event.target)) setOpenIndex(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenIndex(null);
    };
    const onBlur = () => setOpenIndex(null);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [openIndex]);

  const run = (item) => {
    setOpenIndex(null);
    item.run?.(getContext());
  };

  return (
    <nav className="menubar" ref={barRef}>
      {MENUS.map((menu, index) => {
        const isEmpty = menu.items.length === 0;
        const isOpen = openIndex === index;
        return (
          <div key={menu.label} className="menubar__menu">
            <button
              className={`menubar__label${isOpen ? ' menubar__label--open' : ''}${isEmpty ? ' menubar__label--empty' : ''}`}
              type="button"
              title={isEmpty ? menu.emptyHint : undefined}
              aria-haspopup={isEmpty ? undefined : 'menu'}
              aria-expanded={isOpen}
              onPointerDown={(event) => {
                if (isEmpty || event.button !== 0) return;
                setOpenIndex(isOpen ? null : index);
              }}
              onPointerEnter={() => openIndex !== null && !isEmpty && setOpenIndex(index)}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') && !isEmpty) {
                  event.preventDefault();
                  setOpenIndex(index);
                }
              }}
            >
              {menu.label}
            </button>
            {isOpen && <MenuList items={menu.items} ctx={ctx} onRun={run} autoFocus />}
          </div>
        );
      })}
    </nav>
  );
}

export function MenuList({ items, ctx, onRun, autoFocus = false, nested = false }) {
  const listRef = useRef(null);
  const [submenuId, setSubmenuId] = useState(null);
  const resolved = items.map((item) => resolveItem(item, ctx));

  useEffect(() => {
    if (autoFocus) listRef.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [autoFocus]);

  // Arrow keys move between enabled items; Right/Enter opens a submenu.
  const onKeyDown = (event) => {
    const focusable = [...listRef.current.querySelectorAll(':scope > li > [role="menuitem"]:not([aria-disabled="true"])')];
    const current = focusable.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focusable[(current + step + focusable.length) % focusable.length]?.focus();
    } else if (event.key === 'ArrowLeft' && nested) {
      event.stopPropagation();
      setSubmenuId(null);
    }
  };

  return (
    <ul className={`menu${nested ? ' menu--nested' : ''}`} role="menu" ref={listRef} onKeyDown={onKeyDown}>
      {resolved.map((item, i) =>
        item.separator ? (
          <li key={`sep-${i}`} className="menu__separator" role="separator" />
        ) : (
          <li key={item.id} className="menu__entry" onPointerEnter={() => setSubmenuId(item.items ? item.id : null)}>
            <div
              className={`menu__item${item.enabled ? '' : ' menu__item--disabled'}`}
              role="menuitem"
              tabIndex={-1}
              title={item.title}
              aria-disabled={!item.enabled}
              aria-haspopup={item.items ? 'menu' : undefined}
              aria-checked={item.checked}
              onClick={() => item.enabled && !item.items && onRun(item)}
              onKeyDown={(event) => {
                if (!item.enabled) return;
                if (item.items && (event.key === 'ArrowRight' || event.key === 'Enter')) {
                  event.preventDefault();
                  setSubmenuId(item.id);
                } else if (!item.items && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onRun(item);
                }
              }}
            >
              <span className="menu__check">{item.checked ? '✓' : ''}</span>
              <span className="menu__label">{item.label}</span>
              <span className="menu__shortcut">{item.items ? '›' : item.shortcut}</span>
            </div>
            {item.items && submenuId === item.id && item.enabled && (
              <MenuList items={item.items} ctx={ctx} onRun={onRun} nested autoFocus />
            )}
          </li>
        )
      )}
    </ul>
  );
}
