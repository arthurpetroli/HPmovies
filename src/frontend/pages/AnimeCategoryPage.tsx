import { useParams } from 'react-router-dom';
import type { CatalogQuery } from '../../shared/providers';
import { ExplorePage } from './ExplorePage';
const categories: Record<string, { title: string; query: CatalogQuery }> = {
  'most-popular': { title: 'Os favoritos de todo mundo.', query: { sort: 'popular' } },
  'most-favorite': { title: 'Populares da comunidade.', query: { sort: 'popular' } },
  'top-airing': { title: 'A temporada está acontecendo.', query: { status: 'RELEASING', sort: 'trending' } },
  'top-upcoming': { title: 'Já no seu radar.', query: { status: 'NOT_YET_RELEASED', sort: 'popular' } },
  'top-10': { title: 'As histórias mais bem avaliadas.', query: { sort: 'score' } },
  'completed': { title: 'Do primeiro ao último episódio.', query: { status: 'FINISHED' } },
  'recently-updated': { title: 'Novas histórias para descobrir.', query: { sort: 'newest' } },
  'recently-added': { title: 'Novas histórias para descobrir.', query: { sort: 'newest' } },
  'movie': { title: 'Grandes histórias em um filme.', query: { format: 'MOVIE' } },
  'tv': { title: 'Sua próxima série de anime.', query: { format: 'TV' } },
  'special': { title: 'Histórias especiais.', query: { format: 'SPECIAL' } },
  'ova': { title: 'Explore os OVAs.', query: { format: 'OVA' } },
  'ona': { title: 'Explore os ONAs.', query: { format: 'ONA' } },
};
export function AnimeCategoryPage() { const { category = '' } = useParams(); const item = categories[category]; return <ExplorePage title={item?.title} initialQuery={item?.query} />; }
