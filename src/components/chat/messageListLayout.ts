export function resolveMessageListVerticalAlignment(messageCount: number): 'default' | 'bottom-anchored' {
  return messageCount > 0 ? 'bottom-anchored' : 'default';
}
