/** Administrative channel registry. No entry implies authentication or publishing. */
export const MARKETPLACES = [
  { id: 'amazon', name: 'Amazon' },
  { id: 'shein', name: 'SHEIN' },
  { id: 'tiktok-shop', name: 'TikTok Shop' },
  { id: 'mercado-libre', name: 'Mercado Libre' },
] as const;

export type MarketplaceId = typeof MARKETPLACES[number]['id'];
export const isMarketplaceId = (value: unknown): value is MarketplaceId =>
  MARKETPLACES.some(channel => channel.id === value);
