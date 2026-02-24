import { useStore } from '../store/useStore';

export function useArtist() {
  const artists = useStore((state) => state.artists);
  const selectedArtistId = useStore((state) => state.selectedArtistId);
  const selectArtist = useStore((state) => state.selectArtist);
  const isArtistUnlocked = useStore((state) => state.isArtistUnlocked);

  return {
    artists,
    selectedArtistId,
    selectArtist,
    isArtistUnlocked
  };
}
