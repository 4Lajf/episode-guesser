import rawPool from './curated.json';
import type { AnimePoolItem, GlobalPoolSize } from './types';

export const CURATED_GLOBAL_POOL: AnimePoolItem[] = rawPool as AnimePoolItem[];

export function getGlobalPool(size: GlobalPoolSize = 1000): AnimePoolItem[] {
	if (size === 249) {
		return CURATED_GLOBAL_POOL.slice(0, 249);
	}
	return CURATED_GLOBAL_POOL;
}
