import { useEffect, useMemo, useState } from "react";
import { Image } from "react-konva";
import type Konva from "konva";
import type { CanvasItem } from "../types";
import { svgToDataUri } from "../lib/svg";
import type { SymbolDefinition } from "../data/symbols";

type SymbolImageProps = {
  item: CanvasItem;
  symbol: SymbolDefinition;
  onSelect: () => void;
  onChange: (item: CanvasItem) => void;
  shapeRef?: (node: Konva.Image | null) => void;
};

export function SymbolImage({
  item,
  symbol,
  onSelect,
  onChange,
  shapeRef
}: SymbolImageProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const src = useMemo(() => svgToDataUri(symbol.svg, symbol.color), [symbol]);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);

  return (
    <Image
      ref={shapeRef}
      image={image ?? undefined}
      x={item.x}
      y={item.y}
      width={120}
      height={120}
      offsetX={60}
      offsetY={60}
      rotation={item.rotation}
      scaleX={item.scale}
      scaleY={item.scale}
      draggable
      opacity={1}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => {
        onChange({
          ...item,
          x: event.target.x(),
          y: event.target.y()
        });
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const nextScale = Math.max(0.35, Math.min(2.6, node.scaleX()));
        node.scaleX(nextScale);
        node.scaleY(nextScale);

        onChange({
          ...item,
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          scale: nextScale
        });
      }}
    />
  );
}
