import type { AnimePoolItem } from './types';
import rawPool from './curated.json';

export const CURATED_GLOBAL_POOL: AnimePoolItem[] = rawPool as AnimePoolItem[];
