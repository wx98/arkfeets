"""Render a question crop to a compact, transparent WebP thumbnail."""

import json
import sys

from PIL import Image, ImageOps


def main():
    source, crop_text, target = sys.argv[1:4]
    crop = json.loads(crop_text)
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        width, height = image.size
        scale_x = width / crop["sourceWidth"]
        scale_y = height / crop["sourceHeight"]
        left = max(0, min(width - 1, crop["x"] * scale_x))
        top = max(0, min(height - 1, crop["y"] * scale_y))
        right = min(width, (crop["x"] + crop["width"]) * scale_x)
        bottom = min(height, (crop["y"] + crop["height"]) * scale_y)
        region_width = max(1e-6, right - left)
        region_height = max(1e-6, bottom - top)
        ratio = min(1, 320 / max(region_width, region_height))
        size = (max(1, round(region_width * ratio)), max(1, round(region_height * ratio)))
        thumbnail = image.transform(size, Image.Transform.EXTENT, (left, top, right, bottom), resample=Image.Resampling.BICUBIC)
        thumbnail.save(target, format="WEBP", quality=70, method=4)


if __name__ == "__main__":
    main()
