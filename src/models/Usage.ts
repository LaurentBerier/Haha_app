export interface UsageQuota {
  messagesCap: number | null;
  messagesUsed: number;
  resetDate: string;
  softCapMessageShown?: boolean;
  hardCapMessageShown?: boolean;
}
