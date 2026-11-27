export type GameMode = 'classic' | 'unlimited' | 'daily';

export type NavTab = GameMode | 'archive' | 'vn';

export type VnUiSubMode = 'daily' | 'archive' | 'practice' | 'survival';

export type VnPoolSize = 1000 | 250;

export interface VndbUserProfile {
	userId: string;
	username: string;
	totalEntries: number;
	eligibleVns: number;
	labelIds: number[];
	isGlobalPool: boolean;
	poolSize?: VnPoolSize;
}

export interface VnLeaderboardAttemptSummary {
	v: TileStatus;
	y: TileStatus;
	l: TileStatus;
	s: TileStatus;
	g?: boolean;
}

export interface VnDailyLeaderboardEntry {
	anilistUserId: number;
	username: string;
	avatar: string | null;
	siteUrl: string;
	won: boolean;
	gaveUp: boolean;
	attemptsUsed: number;
	points: number;
	completedAt: number;
	tiles: VnLeaderboardAttemptSummary[];
}

export interface VnDailyLeaderboardPayload {
	date: string;
	puzzleNumber: number;
	totalPlayers: number;
	solvedCount: number;
	entries: VnDailyLeaderboardEntry[];
	me: { rank: number; entry: VnDailyLeaderboardEntry } | null;
	authConfigured: boolean;
}

export interface VnArchiveDaySummary {
	date: string;
	puzzleNumber: number;
	status: ArchiveDayStatus;
	attemptsUsed: number;
	leaderboardCount: number;
	leaderboardSolved: number;
}

export interface VnArchivePayload {
	today: string;
	startDate: string;
	totalDays: number;
	solvedCount: number;
	playedCount: number;
	days: VnArchiveDaySummary[];
}

export interface VnAutocompleteEntry {
	id: string;
	t: string;
	a?: string;
	s?: string[];
}

export interface VnReveal {
	id: string;
	title: string;
	enTitle: string | null;
	year: number;
	released: string;
	lengthMinutes: number;
	lengthBucket: number;
	rating: number | null;
	developers: string[];
	isNvl: boolean;
	tags: string[];
	quote?: string | null;
	imageUrl: string;
	vndbUrl: string;
}

export interface VnAttemptFeedback {
	attemptNumber: number;
	guessedId: string | null;
	guessedTitle: string;
	guessedYear: number | null;
	guessedLengthMinutes: number | null;
	guessedStudio: string | null;
	vnStatus: TileStatus;
	yearStatus: TileStatus;
	yearDirection: Direction;
	lengthStatus: TileStatus;
	lengthDirection: Direction;
	studioStatus: TileStatus;
	solved: boolean;
	gaveUp?: boolean;
}

export interface VnRoundPayload {
	roundToken: string;
	stateToken: string;
	imageUrl: string;
	subMode: 'daily' | 'practice' | 'survival';
	stage: number;
	maxAttempts: number;
	isNvl: boolean;
	scopeLabel?: string;
	hintTags?: string[];
	hintQuote?: string | null;
	dailyMeta?: {
		date: string;
		puzzleNumber: number;
		isArchive?: boolean;
	};
	restore?: {
		attempts: VnAttemptFeedback[];
		finished: boolean;
		won: boolean;
		reveal?: VnReveal;
	};
}

export interface VnGuessResponse {
	attempt: VnAttemptFeedback;
	finished: boolean;
	won: boolean;
	nextStage: number;
	nextImageUrl: string;
	stateToken: string;
	pointsAwarded?: number;
	lostLife?: boolean;
	hintTags?: string[];
	hintQuote?: string | null;
	reveal?: VnReveal;
}

export interface VnCompletedSurvivalRound {
	roundIndex: number;
	stageUsed: number;
	points: number;
	lostLife: boolean;
	vnStatus: TileStatus;
	guessedTitle: string;
	reveal: VnReveal;
}

export type ListStatus = 'COMPLETED' | 'CURRENT' | 'PAUSED' | 'DROPPED' | 'REPEATING';

export type GlobalPoolSize = 1000 | 249;

export type ArchiveDayStatus = 'unplayed' | 'in_progress' | 'won' | 'lost' | 'gave_up';

export interface ArchiveDaySummary {
	date: string;
	puzzleNumber: number;
	status: ArchiveDayStatus;
	attemptsUsed: number;
	animeHitAttempt: number | null;
	leaderboardCount: number;
	leaderboardSolved: number;
}

export interface DailyArchivePayload {
	today: string;
	startDate: string;
	totalDays: number;
	solvedCount: number;
	playedCount: number;
	days: ArchiveDaySummary[];
}

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
	g?: boolean;
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
	points: number;
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
		isArchive?: boolean;
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
