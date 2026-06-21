export function svgToDataUri(svg: string, color: string) {
  const encoded = encodeURIComponent(svg.replaceAll("currentColor", color))
    .replaceAll("'", "%27")
    .replaceAll('"', "%22");

  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}
