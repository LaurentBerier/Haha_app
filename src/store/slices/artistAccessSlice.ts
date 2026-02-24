import type { StateCreator } from 'zustand';
import { artists } from '../../config/artists';
import type { StoreState } from '../useStore';

export interface ArtistAccessSlice {
  unlockedArtistIds: string[];
  unlockArtist: (id: string) => void;
  isArtistUnlocked: (id: string) => boolean;
}

export const createArtistAccessSlice: StateCreator<StoreState, [], [], ArtistAccessSlice> = (set, get) => ({
  unlockedArtistIds: artists.filter((artist) => !artist.isPremium).map((artist) => artist.id),
  unlockArtist: (id) =>
    set((state) => ({
      unlockedArtistIds: state.unlockedArtistIds.includes(id)
        ? state.unlockedArtistIds
        : [...state.unlockedArtistIds, id]
    })),
  isArtistUnlocked: (id) => get().unlockedArtistIds.includes(id)
});
