export interface MovieCard {
  slug: string;
  name: string;
  original_name: string | null;
  thumb_url: string | null;
  poster_url: string | null;
  description: string | null;
  year: string | null;
  quality: string | null;
  language: string | null;
  current_episode: string | null;
  total_episodes: number | null;
  time: string | null;
}

export interface Episode {
  name: string;
  slug: string | null;
  embed_url: string | null;
  m3u8_url: string | null;
}

export interface ServerGroup {
  name: string;
  episodes: Episode[];
}

export interface MovieDetail extends MovieCard {
  provider_id: string | null;
  director: string | null;
  casts: string | null;
  formats: string[];
  genres: string[];
  countries: string[];
  servers: ServerGroup[];
}

export interface PaginatedMovies {
  items: MovieCard[];
  current_page: number;
  total_page: number;
  total_items: number;
  per_page: number;
}

export type UserRole = "user" | "moderator" | "admin";

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_active: boolean;
  role: UserRole;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface ApiErrorShape {
  detail: unknown;
  code: string;
}
