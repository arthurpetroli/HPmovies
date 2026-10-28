import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Topbar } from './frontend/components/navigation/Topbar';
import { NavigationRail } from './frontend/components/navigation/NavigationRail';
import { InterfaceSettings } from './frontend/components/navigation/InterfaceSettings';
import { useWatchPreferences } from './frontend/services/watchPreferences';
import { Footer } from './frontend/components/navigation/Footer';
import { AnimeHomePage } from './frontend/pages/AnimeHomePage';
import { AnimeDetailsPage } from './frontend/pages/AnimeDetailsPage';
import { AnimeSearchPage } from './frontend/pages/AnimeSearchPage';
import { AnimeCategoryPage } from './frontend/pages/AnimeCategoryPage';
import { AnimeGenrePage } from './frontend/pages/AnimeGenrePage';
import { ExplorePage } from './frontend/pages/ExplorePage';
import { LibraryPage } from './frontend/pages/LibraryPage';
import { WatchLoadingShell } from './frontend/components/player/WatchLoadingShell';
import { loadWatchPage } from './frontend/services/watchEntry';

const SchedulePage = lazy(() => import('./frontend/pages/SchedulePage').then(module => ({ default: module.SchedulePage })));
const WatchPage = lazy(() => loadWatchPage().then((module) => ({ default: module.WatchPage })));
const MangaHomePage = lazy(() => import('./frontend/pages/MangaHomePage').then(module => ({ default: module.MangaHomePage })));
const MangaDetailsPage = lazy(() => import('./frontend/pages/MangaDetailsPage').then(module => ({ default: module.MangaDetailsPage })));
const MangaReaderPage = lazy(() => import('./frontend/pages/MangaReaderPage').then(module => ({ default: module.MangaReaderPage })));
const NovelHomePage = lazy(() => import('./frontend/pages/NovelHomePage').then(module => ({ default: module.NovelHomePage })));
const NovelDetailsPage = lazy(() => import('./frontend/pages/NovelDetailsPage').then(module => ({ default: module.NovelDetailsPage })));
const NovelReaderPage = lazy(() => import('./frontend/pages/NovelReaderPage').then(module => ({ default: module.NovelReaderPage })));
const ProvidersPage = lazy(() => import('./frontend/pages/ProvidersPage').then(module => ({ default: module.ProvidersPage })));
const SourcesPage = lazy(() => import('./frontend/pages/SourcesPage').then(module => ({ default: module.SourcesPage })));
const SourceMangaReaderPage = lazy(() => import('./frontend/pages/MangaReaderPage').then(module => ({ default: module.SourceMangaReaderPage })));

function ScrollReset() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (!(previousPath.current.startsWith('/watch/') && pathname.startsWith('/watch/'))) window.scrollTo({ top: 0 });
    previousPath.current = pathname;
  }, [pathname]);
  return null;
}

function RouteLoading() {
  const { pathname } = useLocation();
  return pathname.startsWith('/watch/') ? <WatchLoadingShell /> : <main className="min-h-[70vh] px-6 pt-32" aria-busy="true"><p className="text-center text-white/60">Carregando…</p></main>;
}

function App() {
  const [navigationExpanded, setNavigationExpanded] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const preferences = useWatchPreferences();
  return (
    <BrowserRouter>
      <div className={`app-layout min-h-screen bg-[var(--background)] text-white${navigationExpanded ? ' navigation-expanded' : ''}${preferences.ambient ? '' : ' ambient-disabled'}`}>
        <ScrollReset />
        <NavigationRail expanded={navigationExpanded} onToggle={() => setNavigationExpanded(value => !value)} onSearch={() => setSearchRequest(value => value + 1)} onSettings={() => setSettingsOpen(true)} />
        <Topbar searchRequest={searchRequest} />
        {settingsOpen && <InterfaceSettings onClose={() => setSettingsOpen(false)} navigationExpanded={navigationExpanded} onToggleNavigation={() => setNavigationExpanded(value => !value)} />}
        <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<AnimeHomePage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/sources/manga/:mangaId/read/:chapterId" element={<SourceMangaReaderPage />} />
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
