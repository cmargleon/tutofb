import React, { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  containerClassName?: string;
  imageClassName?: string;
  zoomScale?: number;
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>['referrerPolicy'];
  children?: React.ReactNode;
}

export const HoverZoomImage: React.FC<Props> = ({
  src,
  alt,
  containerClassName = '',
  imageClassName = '',
  zoomScale = 1.9,
  referrerPolicy = 'no-referrer',
  children,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const resolvedZoomScale = useMemo(() => {
    if (naturalSize.width === 0 || naturalSize.height === 0 || containerSize.width === 0 || containerSize.height === 0) {
      return zoomScale;
    }

    const fitMode = imageClassName.includes('object-contain') ? 'contain' : 'cover';
    const widthRatio = containerSize.width / naturalSize.width;
    const heightRatio = containerSize.height / naturalSize.height;
    const baseScale = fitMode === 'contain'
      ? Math.min(widthRatio, heightRatio)
      : Math.max(widthRatio, heightRatio);

    if (!Number.isFinite(baseScale) || baseScale <= 0) {
      return zoomScale;
    }

    return Math.max(1, 1 / baseScale);
  }, [containerSize.height, containerSize.width, imageClassName, naturalSize.height, naturalSize.width, zoomScale]);

  const updateOrigin = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    container.style.setProperty('--zoom-origin-x', `${Math.min(100, Math.max(0, x))}%`);
    container.style.setProperty('--zoom-origin-y', `${Math.min(100, Math.max(0, y))}%`);
  };

  const resetOrigin = () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.style.setProperty('--zoom-origin-x', '50%');
    container.style.setProperty('--zoom-origin-y', '50%');
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden cursor-zoom-in ${containerClassName}`.trim()}
      onMouseEnter={(event) => {
        setIsHovering(true);
        updateOrigin(event.clientX, event.clientY);
      }}
      onMouseMove={(event) => updateOrigin(event.clientX, event.clientY)}
      onMouseLeave={() => {
        setIsHovering(false);
        resetOrigin();
      }}
      style={{
        ['--zoom-origin-x' as string]: '50%',
        ['--zoom-origin-y' as string]: '50%',
      }}
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy={referrerPolicy}
        onLoad={(event) => {
          const image = event.currentTarget;
          setNaturalSize({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        }}
        className={`h-full w-full transition-transform duration-200 ease-out will-change-transform ${imageClassName}`.trim()}
        style={{
          transform: isHovering ? `scale(${resolvedZoomScale})` : 'scale(1)',
          transformOrigin: 'var(--zoom-origin-x) var(--zoom-origin-y)',
        }}
      />
      {children}
    </div>
  );
};
