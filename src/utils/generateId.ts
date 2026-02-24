let counter = 0;

export function generateId(prefix = 'id'): string {
  // Counter resets on app restart. Collision risk remains negligible because a cross-session
  // collision requires the same millisecond timestamp and counter value.
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now()}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
