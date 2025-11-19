export interface Anime {
  id: string;
  name: string;
  jname?: string;
  poster: string;
  duration?: string;
  type?: string;
  rating?: string | null;
  episodes?: {
    sub: number;
    dub: number;
  };
}

export interface AnimeDetails {
  id: string;
  name: string;
  poster: string;
  description: string;
  stats: {
    rating: string;
    quality: string;
    episodes: {
      sub: number;
      dub: number;
    };
    type: string;
    duration: string;
  };
  moreInfo: {
    aired: string;
    genres: string[];
    status: string;
    studios: string;
    producers: string[];
  };
}

export interface Episode {
  title: string;
  episodeId: string;
  number: number;
  isFiller: boolean;
}

export const ANIME_CATEGORIES = [
  'most-popular',
  'most-favorite',
  'completed',
  'recently-updated',
  'recently-added',
  'top-upcoming',
  'subbed-anime',
  'dubbed-anime',
  'top-airing',
] as const;

export type AnimeCategory = typeof ANIME_CATEGORIES[number];

export const ANIME_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Isekai',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
] as const;

export type AnimeGenre = typeof ANIME_GENRES[number];