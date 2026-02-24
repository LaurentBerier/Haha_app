import type { StateCreator } from 'zustand';
import type { Artist } from '../../models/Artist';
import { artists as seededArtists } from '../../config/artists';
import type { StoreState } from '../useStore';

export interface ArtistSlice {
  artists: Artist[];
  selectedArtistId: string | null;
  selectArtist: (id: string) => void;
  getSelectedArtist: () => Artist | null;
}

export const createArtistSlice: StateCreator<StoreState, [], [], ArtistSlice> = (set, get) => ({
  artists: seededArtists,
  selectedArtistId: seededArtists[0]?.id ?? null,
  selectArtist: (id) => set({ selectedArtistId: id }),
  getSelectedArtist: () => {
    const { artists, selectedArtistId } = get();
    if (!selectedArtistId) {
      return null;
    }
    return artists.find((artist) => artist.id === selectedArtistId) ?? null;
  }
});
