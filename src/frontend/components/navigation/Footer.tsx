import { ArrowUpRight, MonitorPlay } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '../ui/Brand';

export function Footer() {
  return <footer className="site-footer">
    <div className="content-width footer-main">
      <div className="footer-brand"><Brand /><p>Novas histórias. Novos mundos. Sua próxima história começa aqui.</p></div>
      <div className="footer-links"><h3>Explore</h3><Link to="/explore">Todos os animes</Link><Link to="/cinema">Filmes e séries</Link><Link to="/category/most-popular">Mais populares</Link><Link to="/manga">Mangás</Link><Link to="/novels">Light novels</Link></div>
      <div className="footer-links"><h3>Seu espaço</h3><Link to="/library">Minha lista e favoritos</Link><Link to="/library?tab=history">Histórico de reprodução</Link><Link to="/sources">Assistir e ler pelas fontes</Link><Link to="/providers">Disponibilidade das fontes</Link><Link to="/watch/demo"><MonitorPlay size={14} aria-hidden="true" /> Conhecer o player</Link></div>
      <div className="footer-note"><h3>De onde vem o catálogo</h3><p>Catálogos AniList, MangaDex e Cinemeta. Reprodução disponível apenas para fontes autorizadas.</p><a href="https://anilist.co" target="_blank" rel="noopener noreferrer">Conheça o AniList <ArrowUpRight size={14} aria-hidden="true" /></a></div>
    </div>
    <div className="content-width footer-bottom"><span>HPmovies · Animes, filmes, séries e leitura</span><span>Lista e progresso salvos neste navegador</span></div>
  </footer>;
}
