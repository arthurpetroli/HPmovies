import { useParams } from 'react-router-dom';
import { catalogGenre, genreLabel } from '../components/filters/genreLabels';
import { ExplorePage } from './ExplorePage';
export function AnimeGenrePage() { const { genre = '' } = useParams(); return <ExplorePage title={genreLabel(catalogGenre(genre))} initialQuery={{ genre: catalogGenre(genre) }} />; }
