const IMAGE_EXTENSION_PATTERN = /(\.(?:png|jpe?g|webp|gif|bmp|tiff|avif))(?:[?#].*)?$/i;

export const trimUrlAfterImageExtension = (value: string): string => {
  const match = value.match(IMAGE_EXTENSION_PATTERN);
  if (!match || match.index === undefined) {
    return value;
  }

  return value.slice(0, match.index + match[1].length);
};
