import { useEffect, useState } from "react";
import { Image } from "react-konva";
import type { CanvasReference } from "../types";

type ReferenceImageProps = {
  reference: CanvasReference;
  canvasWidth: number;
  canvasHeight: number;
};

export function ReferenceImage({ reference, canvasWidth, canvasHeight }: ReferenceImageProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let active = true;
    setImage(null);
    const nextImage = new window.Image();
    nextImage.onload = () => {
      if (active) setImage(nextImage);
    };
    nextImage.src = reference.src;
    return () => {
      active = false;
    };
  }, [reference.src]);

  const availableWidth = Math.max(1, canvasWidth - 56);
  const availableHeight = Math.max(1, canvasHeight - 56);
  const fitScale = Math.min(
    availableWidth / reference.width,
    availableHeight / reference.height
  );
  const width = reference.width * fitScale;
  const height = reference.height * fitScale;

  return (
    <Image
      name="maze-reference"
      image={image ?? undefined}
      x={(canvasWidth - width) / 2}
      y={(canvasHeight - height) / 2}
      width={width}
      height={height}
      opacity={0.55}
      listening={false}
    />
  );
}
