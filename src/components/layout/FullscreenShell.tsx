import type { ReactNode } from 'react';

interface FullscreenShellProps {
  onClose: () => void;
  panelClassName: string;
  title: ReactNode;
  closeTestId?: string;
  closeTitle?: string;
  children: ReactNode;
}

export function FullscreenShell({
  onClose,
  panelClassName,
  title,
  closeTestId,
  closeTitle = '关闭全屏',
  children,
}: FullscreenShellProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`fullscreen-modal ${panelClassName}`} onClick={(e) => e.stopPropagation()}>
        <div className="fullscreen-header">
          <div className="fullscreen-title">{title}</div>
          <button
            className="close-fullscreen-btn"
            onClick={onClose}
            title={closeTitle}
            data-testid={closeTestId}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
