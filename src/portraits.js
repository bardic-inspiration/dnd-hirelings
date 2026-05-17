import manifest from 'virtual:portrait-manifest';

// Set of valid image file extensions for portraits
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// Builds a list of portrait objects with name and URL from the provided files and base path
export function buildPortraitList(files, basePath) {
  return files.map(f => ({ name: f, url: basePath + f }));
}

// Export a list of portrait URLs built from the manifest data
export const PORTRAIT_URLS = buildPortraitList(manifest.files, manifest.basePath);

// Utility function to check if a given file is a valid image file based on its extension
export function isValidImageFile(file) {
  return IMAGE_EXTS.has(file.name.split('.').pop().toLowerCase());
}
