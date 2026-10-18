import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

/** @param {string} source @param {import("../question/questionRepository.js").QuestionRecord["question"] & {}} crop */
export async function renderQuestionThumbnail(source, crop) {
  const codec = globalThis.Bun;
  const input = await readFile(source);
  const pngBytes = codec
    ? await new codec.Image(input).png().buffer()
    : await (await import("sharp")).default(input).autoOrient().png().toBuffer();
  const { data, width: imageWidth, height: imageHeight } = PNG.sync.read(pngBytes);
  const scaleX = imageWidth / crop.sourceWidth;
  const scaleY = imageHeight / crop.sourceHeight;
  const left = Math.max(0, Math.min(imageWidth - 1, crop.x * scaleX));
  const top = Math.max(0, Math.min(imageHeight - 1, crop.y * scaleY));
  const right = Math.min(imageWidth, (crop.x + crop.width) * scaleX);
  const bottom = Math.min(imageHeight, (crop.y + crop.height) * scaleY);
  const width = Math.max(1e-6, right - left);
  const height = Math.max(1e-6, bottom - top);
  const ratio = Math.min(1, 320 / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * ratio));
  const outputHeight = Math.max(1, Math.round(height * ratio));
  const output = Buffer.allocUnsafe(outputWidth * outputHeight * 4);

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.max(0, Math.min(imageHeight - 1, top + (y + 0.5) * height / outputHeight - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(imageHeight - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.max(0, Math.min(imageWidth - 1, left + (x + 0.5) * width / outputWidth - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(imageWidth - 1, x0 + 1);
      const fx = sourceX - x0;
      const pixels = [
        [(y0 * imageWidth + x0) * 4, (1 - fx) * (1 - fy)],
        [(y0 * imageWidth + x1) * 4, fx * (1 - fy)],
        [(y1 * imageWidth + x0) * 4, (1 - fx) * fy],
        [(y1 * imageWidth + x1) * 4, fx * fy],
      ];
      const target = (y * outputWidth + x) * 4;
      let alpha = 0;
      for (const [index, weight] of pixels) alpha += data[index + 3] * weight;
      output[target + 3] = Math.round(alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        let premultiplied = 0;
        for (const [index, weight] of pixels) premultiplied += data[index + channel] * data[index + 3] * weight;
        output[target + channel] = alpha > 0 ? Math.round(premultiplied / alpha) : 0;
      }
    }
  }

  if (codec) {
    const image = new PNG({ width: outputWidth, height: outputHeight });
    output.copy(image.data);
    const png = PNG.sync.write(image);
    return Buffer.from(await new codec.Image(png).webp({ quality: 70 }).buffer());
  }
  return (await import("sharp")).default(output, { raw: { width: outputWidth, height: outputHeight, channels: 4 } })
    .webp({ quality: 70, effort: 4 }).toBuffer();
}
