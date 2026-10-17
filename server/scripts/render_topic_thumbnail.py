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
        left = max(0, min(width - 1, round(crop["x"] * scale_x)))
        top = max(0, min(height - 1, round(crop["y"] * scale_y)))
        right = max(left + 1, min(width, round((crop["x"] + crop["width"]) * scale_x)))
        bottom = max(top + 1, min(height, round((crop["y"] + crop["height"]) * scale_y)))
        thumbnail = image.crop((left, top, right, bottom))
        thumbnail.thumbnail((320, 320), Image.Resampling.LANCZOS)
        thumbnail.save(target, format="WEBP", quality=70, method=4)


if __name__ == "__main__":
    main()
