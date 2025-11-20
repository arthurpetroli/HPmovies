import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Topbar } from './frontend/components/navigation/Topbar';
import { AnimeHomePage } from './frontend/pages/AnimeHomePage';
import { AnimeDetailsPage } from './frontend/pages/AnimeDetailsPage';
import { AnimeSearchPage } from './frontend/pages/AnimeSearchPage';
import { AnimeCategoryPage } from './frontend/pages/AnimeCategoryPage';
import { AnimeGenrePage } from './frontend/pages/AnimeGenrePage';
import { WatchPage } from './frontend/pages/WatchPage';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-900">
        <Topbar />
        <Routes>
          <Route path="/" element={<AnimeHomePage />} />
          <Route path="/anime/:animeId" element={<AnimeDetailsPage />} />
          <Route path="/search" element={<AnimeSearchPage />} />
          <Route path="/category/:category" element={<AnimeCategoryPage />} />
          <Route path="/genre/:genre" element={<AnimeGenrePage />} />
          <Route path="/watch/*" element={<WatchPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;