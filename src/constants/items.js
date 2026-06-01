import manifest from 'virtual:item-manifest';

function buildItemList(files, basePath) {
  return files.map(f => ({ name: f, url: basePath + f }));
}

export const ITEM_URLS = buildItemList(manifest.files, manifest.basePath);

export { isValidImageFile } from './portraits.js';
