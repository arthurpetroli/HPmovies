import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Topbar } from './frontend/components/navigation/Topbar';
import { Footer } from './frontend/components/navigation/Footer';
import { AnimeHomePage } from './frontend/pages/AnimeHomePage';
import { AnimeDetailsPage } from './frontend/pages/AnimeDetailsPage';
import { AnimeSearchPage } from './frontend/pages/AnimeSearchPage';
import { AnimeCategoryPage } from './frontend/pages/AnimeCategoryPage';
import { AnimeGenrePage } from './frontend/pages/AnimeGenrePage';
import { ExplorePage } from './frontend/pages/ExplorePage';
import { LibraryPage } from './frontend/pages/LibraryPage';

const WatchPage = lazy(() => import('./frontend/pages/WatchPage').then((module) => ({ default: module.WatchPage })));
const MangaHomePage = lazy(() => import('./frontend/pages/MangaHomePage').then(module => ({ default: module.MangaHomePage })));
const MangaDetailsPage = lazy(() => import('./frontend/pages/MangaDetailsPage').then(module => ({ default: module.MangaDetailsPage })));
const MangaReaderPage = lazy(() => import('./frontend/pages/MangaReaderPage').then(module => ({ default: module.MangaReaderPage })));
const NovelHomePage = lazy(() => import('./frontend/pages/NovelHomePage').then(module => ({ default: module.NovelHomePage })));
const NovelDetailsPage = lazy(() => import('./frontend/pages/NovelDetailsPage').then(module => ({ default: module.NovelDetailsPage })));
const NovelReaderPage = lazy(() => import('./frontend/pages/NovelReaderPage').then(module => ({ default: module.NovelReaderPage })));
const ProvidersPage = lazy(() => import('./frontend/pages/ProvidersPage').then(module => ({ default: module.ProvidersPage })));

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0b1011] text-white">
        <ScrollReset />
        <Topbar />
        <Suspense fallback={<main className="min-h-[70vh] px-6 pt-32" aria-busy="true"><p className="text-center text-white/60">Carregando…</p></main>}>
        <Routes>
          <Route path="/" element={<AnimeHomePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/manga" element={<MangaHomePage />} />
          <Route path="/manga/:mangaId" element={<MangaDetailsPage />} />
          <Route path="/manga/:mangaId/read/:chapterId" element={<MangaReaderPage />} />
          <Route path="/novels" element={<NovelHomePage />} />
          <Route path="/novel/:novelId" element={<NovelDetailsPage />} />
          <Route path="/novel/:novelId/read/:chapterId" element={<NovelReaderPage />} />
          <Route path="/anime/:animeId" element={<AnimeDetailsPage />} />
          <Route path="/search" element={<AnimeSearchPage />} />
          <Route path="/category/:category" element={<AnimeCategoryPage />} />
          <Route path="/genre/:genre" element={<AnimeGenrePage />} />
          <Route path="/watch/*" element={<WatchPage />} />
          <Route path="*" element={<main className="mx-auto min-h-[65vh] max-w-3xl px-6 pt-40 text-center"><h1 className="mb-4 text-3xl font-bold">Página não encontrada</h1><Link to="/" className="text-emerald-300 hover:underline">Voltar ao início</Link></main>} />
        </Routes>
        </Suspense>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
