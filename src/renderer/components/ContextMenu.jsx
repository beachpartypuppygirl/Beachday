import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getContext } from '../menus/commands.js';
import { MenuList } from './MenuBar.jsx';

/**
 * A right-click menu at `at` ({ x, y }), built from command ids like the menu
 * bar (menus/commands.js). The track list and the art pane each pass their own
 * items. Closes on Escape, a click elsewhere, or the window losing focus.
 */
export default function ContextMenu({ at, items, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: at.x, top: at.y });

  // Keep the menu on screen near the window edges.
  useLayoutEffect(() => {
    const rect = ref.current.firstElementChild.getBoundingClientRect();
    setPosition({
      left: Math.min(at.x, window.innerWidth - rect.width - 8),
      top: at.y + rect.height > window.innerHeight - 8 ? Math.max(8, at.y - rect.height) : at.y,
    });
  }, [at]);

  useEffect(() => {
    const onPointerDown = (event) => !ref.current.contains(event.target) && onClose();
    const onKeyDown = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div className="contextmenu" ref={ref} style={position}>
      <MenuList
        items={items}
        ctx={getContext()}
        autoFocus
        onRun={(item) => {
          onClose();
          item.run?.(getContext());
        }}
      />
    </div>
  );
}
