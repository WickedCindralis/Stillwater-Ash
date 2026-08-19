export interface AshState {
  id: string;
  name: string;
  status: string;
  lastHeartbeat: string | null;
  tokensUsed: number;
  selfPromptPaused: number;
  selfPromptIntervalOverride: number;
  apiKillSwitch: number;
  selfPromptIncludeHistory: number;
  modelPrimary: string;
  modelFallback: string;
  activeModel: string;
  voiceId: string;
  wickedStatus: string;
  wickedStatusMessage: string;
  tiktokUsername: string;
}

export interface HeraldComment {
  id: number;
  commentId: string;
  videoId: string;
  videoDesc: string;
  videoUrl: string;
  author: string;
  text: string;
  commentCreatedAt: string | null;
  fetchedAt: string;
  status: "new" | "answered" | "ignored" | "saved";
  draft: string;
  seenByAsh: number;
}

export interface AshActivity {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
}

export interface SystemInfo {
  buildName: string;
  status: string;
  pingIntervalMs: number;
  pingIntervalOverrideMinutes: number;
  heartbeatIntervalMs: number;
  heartbeatIntervalOverrideMinutes: number;
  selfPromptPaused: number;
  apiKillSwitch: number;
  lastHeartbeat: string | null;
  tokensUsed: number;
}

export interface AshMessage {
  id: number;
  role: string;
  content: string;
  imageUrl: string;
  source: string;
  createdAt: string;
}

export interface AshChessGame {
  id: number;
  fen: string;
  moves: string; // SAN history, space-separated
  status: string; // active | checkmate | stalemate | draw | resigned | abandoned
  result: string; // "wicked" | "ash" | "draw" | ""
  paused: number; // 1 = paused (Ash is told not to wait for a move)
  createdAt: string;
  updatedAt: string;
}

export interface AshConnect4Game {
  id: number;
  moves: string; // column numbers 1-7, space-separated, Wicked first
  status: string; // active | won | draw | resigned | abandoned
  result: string; // "wicked" | "ash" | "draw" | ""
  paused: number;
  createdAt: string;
  updatedAt: string;
}

export interface AshDiaryEntry {
  id: number;
  content: string;
  createdAt: string;
}

export interface DiscordChannel {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
}

export interface AvailableDiscordChannel extends DiscordChannel {
  canRead: boolean;
  canReply: boolean;
  permissionError: string;
}

export interface SelectedDiscordChannel extends DiscordChannel {
  id: number;
  selectedAt: string;
}

export interface DiscordActivity {
  id: number;
  discordMessageId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  content: string;
  kind: string;
  deliveryStatus: string;
  replyDiscordMessageId: string;
  deliveryError: string;
  createdAt: string;
  recordedAt: string;
  updatedAt: string;
}

export interface DiscordStatus {
  connectionState: "not_configured" | "connecting" | "connected" | "error";
  connectionError: string;
  connectedAt: string | null;
  botUser: string;
  inviteUrl: string;
  requiredIntent: string;
  requiredPermissions: string[];
  availableChannels: AvailableDiscordChannel[];
  selectedChannels: SelectedDiscordChannel[];
  activity: DiscordActivity[];
}
