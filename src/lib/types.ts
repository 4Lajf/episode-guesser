export type GameMode = 'classic' | 'unlimited' | 'daily';

export type ListStatus = 'COMPLETED' | 'CURRENT' | 'PAUSED' | 'DROPPED' | 'REPEATING';

export type GlobalPoolSize = 1000 | 249;

export interface AuthUser {
	anilistUserId: number;
	username: string;
	avatar: string | null;
	siteUrl: string;
}

export interface LeaderboardAttemptSummary {
	a: TileStatus;
	y: TileStatus;
	e: TileStatus;
}

export interface DailyLeaderboardEntry {
	anilistUserId: number;
	username: string;
	avatar: string | null;
	siteUrl: string;
	won: boolean;
	gaveUp: boolean;
	attemptsUsed: number;
	animeHitAttempt: number | null;
	solveMs: number;
	completedAt: number;
	tiles: LeaderboardAttemptSummary[];
}

export interface DailyLeaderboardPayload {
	date: string;
	puzzleNumber: number;
	totalPlayers: number;
	solvedCount: number;
	entries: DailyLeaderboardEntry[];
	me: { rank: number; entry: DailyLeaderboardEntry } | null;
	authConfigured: boolean;
}

export interface AutocompleteEntry {
	/** Canonical display title */
	t: string;
	/** Optional clean alternate (e.g. English) title for search & subtle disambiguation */
	a?: string;
	/** Known episode count from global catalog (reflects selected title only) */
	ep?: number;
	/** Extra normalized search aliases (e.g. nicknames like "danmachi") */
	s?: string[];
}

export interface AnimePoolItem {
	id: number;
	episodes: number | null;
	progress: number;
	status: ListStatus;
	format: string | null;
	seasonYear: number | null;
	titleRomaji: string;
	titleEnglish: string | null;
	titleNative: string | null;
	synonyms: string[];
	franchiseTitles: string[];
	genres: string[];
	studio: string | null;
	coverImage: string | null;
}

export interface AniListProfile {
	username: string;
	avatar: string | null;
	totalEntries: number;
	eligibleShows: number;
	isGlobalPool: boolean;
	globalPoolSize?: GlobalPoolSize;
	statuses: ListStatus[];
	includeSingleEp: boolean;
	titlesForDropdown: string[];
	pool: AnimePoolItem[];
}

export interface RoundPayload {
	roundToken: string;
	imageUrl: string;
	mode: GameMode;
	dailyStateToken?: string;
	dailyMeta?: {
		date: string;
		puzzleNumber: number;
		scopeLabel: string;
		maxAttempts: number;
		zoomSteps: number[];
	};
	dailyRestore?: {
		attempts: WordleAttemptFeedback[];
		finished: boolean;
		won: boolean;
		reveal?: EpisodeReveal;
	};
}

export interface EpisodeReveal {
	anilistId: number;
	titleRomaji: string;
	titleEnglish: string | null;
	episodeNumber: number;
	totalEpisodes: number;
	episodeTitle: string | null;
	airDate: string | null;
	overview: string | null;
	seasonYear: number | null;
	studio: string | null;
	coverImage: string | null;
	imageUrl: string;
	anilistUrl: string;
}

export interface ClassicGuessResponse {
	mode: 'classic' | 'unlimited';
	skipped: boolean;
	guessedTitle: string;
	guessedEpisode: number | null;
	animeMatch: 'exact' | 'franchise' | 'wrong';
	animePoints: number;
	episodePoints: number;
	totalPoints: number;
	episodeDistance: number | null;
	episodeLabel: string;
	reveal: EpisodeReveal;
}

export type TileStatus = 'hit' | 'close' | 'miss';
export type Direction = 'up' | 'down' | 'exact' | null;

export interface WordleAttemptFeedback {
	attemptNumber: number;
	guessedTitle: string;
	guessedEpisode: number;
	guessedYear: number | null;
	animeStatus: TileStatus;
	yearStatus: TileStatus;
	yearDirection: Direction;
	episodeStatus: TileStatus;
	episodeDirection: Direction;
	solved: boolean;
	gaveUp?: boolean;
}

export interface WordleGuessResponse {
	mode: 'daily';
	attempt: WordleAttemptFeedback;
	finished: boolean;
	won: boolean;
	dailyStateToken: string;
	nextImageUrl: string;
	reveal?: EpisodeReveal;
}

export interface CompletedClassicRound {
	roundIndex: number;
	result: ClassicGuessResponse;
}
