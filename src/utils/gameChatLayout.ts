import { theme } from '../theme';

export interface ResolveGameChatWindowLayoutInput {
  viewportHeight: number;
  composerOffset: number;
  protectedAreaBottomY: number | null;
  fallbackTopRatio?: number;
  minOverlayTopRatio?: number;
  maxOverlayTopRatio?: number;
  minChatWindowHeight?: number;
}

export interface GameChatWindowLayout {
  conversationOverlayTop: number;
  chatWindowMaxHeight: number;
  screenPaddingBottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toSafePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

export function resolveGameChatWindowLayout(input: ResolveGameChatWindowLayoutInput): GameChatWindowLayout {
  const viewportHeight = toSafePositiveInt(input.viewportHeight, 800);
  const composerOffset = toSafePositiveInt(input.composerOffset, 96);
  const fallbackTopRatio = Number.isFinite(input.fallbackTopRatio) ? (input.fallbackTopRatio as number) : 0.5;
  const minOverlayTopRatio = Number.isFinite(input.minOverlayTopRatio)
    ? (input.minOverlayTopRatio as number)
    : 0.22;
  const maxOverlayTopRatio = Number.isFinite(input.maxOverlayTopRatio)
    ? (input.maxOverlayTopRatio as number)
    : 0.82;
  const minChatWindowHeight = toSafePositiveInt(input.minChatWindowHeight ?? 160, 160);

  const fallbackOverlayTop = Math.floor(viewportHeight * fallbackTopRatio);
  const measuredOverlayTop =
    typeof input.protectedAreaBottomY === 'number' && Number.isFinite(input.protectedAreaBottomY)
      ? Math.ceil(Math.max(0, input.protectedAreaBottomY) + theme.spacing.sm)
      : fallbackOverlayTop;

  const minOverlayTop = Math.floor(viewportHeight * minOverlayTopRatio);
  const maxOverlayTop = Math.floor(viewportHeight * maxOverlayTopRatio);
  const conversationOverlayTop = clamp(measuredOverlayTop, minOverlayTop, maxOverlayTop);

  const chatWindowMaxHeight = Math.max(
    minChatWindowHeight,
    Math.floor(viewportHeight - composerOffset - conversationOverlayTop - theme.spacing.xs)
  );

  const screenPaddingBottom = chatWindowMaxHeight + composerOffset + theme.spacing.lg;

  return {
    conversationOverlayTop,
    chatWindowMaxHeight,
    screenPaddingBottom
  };
}
