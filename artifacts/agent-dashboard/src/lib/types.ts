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

export interface AshDiaryEntry {
  id: number;
  content: string;
  createdAt: string;
}
