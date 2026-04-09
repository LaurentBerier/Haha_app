export interface UsageQuota {
  messagesCap: number | null;
  messagesUsed: number;
  resetDate: string;
  threshold1MessageShown?: boolean;
  threshold2MessageShown?: boolean;
  threshold3MessageShown?: boolean;
  threshold4MessageShown?: boolean;
  threshold5MessageShown?: boolean;
  isBlocked?: boolean;
}
