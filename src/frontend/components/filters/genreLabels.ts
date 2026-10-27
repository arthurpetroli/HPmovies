const genreNames: Record<string, string> = { Action: 'Ação', Adventure: 'Aventura', Comedy: 'Comédia', Drama: 'Drama', Fantasy: 'Fantasia', Horror: 'Terror', Mystery: 'Mistério', Romance: 'Romance', 'Sci-Fi': 'Ficção científica', 'Slice of Life': 'Cotidiano', Sports: 'Esportes', Supernatural: 'Sobrenatural', Thriller: 'Suspense', Music: 'Música', Psychological: 'Psicológico', Mecha: 'Mecha', Ecchi: 'Ecchi', Mahou: 'Magia' };
export const genreLabel = (genre: string) => genreNames[genre] || genre;

export const catalogGenre = (value: string) => value.toLowerCase() === 'sci-fi' ? 'Sci-Fi' : value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
