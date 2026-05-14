import manifest from 'virtual:portrait-manifest';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

export function buildPortraitList(files, basePath) {
  return files.map(f => ({ name: f, url: basePath + f }));
}

export const PORTRAIT_URLS = buildPortraitList(manifest.files, manifest.basePath);

export function isValidImageFile(file) {
  return IMAGE_EXTS.has(file.name.split('.').pop().toLowerCase());
}
