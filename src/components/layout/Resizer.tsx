import React, { useCallback, useEffect, useState } from 'react';

interface ResizerProps {
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export const Resizer: React.FC<ResizerProps> = ({
  onResize,
  onResizeStart,
  onResizeEnd,
}) => {
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    onResizeStart?.();
    
    // 添加全局鼠标样式
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [onResizeStart]);

  useEffect(() => {
    if (!isResizing) return;

    let animationFrameId: number;
    let lastClientX: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (lastClientX === null) {
        lastClientX = e.clientX;
        return;
      }

      // 使用 requestAnimationFrame 优化性能
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = requestAnimationFrame(() => {
        if (lastClientX !== null) {
          const delta = e.clientX - lastClientX;
          lastClientX = e.clientX;
          onResize(delta);
        }
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      onResizeEnd?.();
      
      // 恢复全局鼠标样式
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isResizing, onResize, onResizeEnd]);

  return (
    <div
      className={`resizer ${isResizing ? 'resizing' : ''}`}
      onMouseDown={handleMouseDown}
      title="拖动调整宽度"
    >
      <div className="resizer-line" />
    </div>
  );
};
