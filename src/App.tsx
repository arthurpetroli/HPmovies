import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Topbar } from './frontend/components/navigation/Topbar';
import { AnimeHomePage } from './frontend/pages/AnimeHomePage';
import { AnimeDetailsPage } from './frontend/pages/AnimeDetailsPage';
import { AnimeSearchPage } from './frontend/pages/AnimeSearchPage';
import { AnimeGenrePage } from './frontend/pages/AnimeGenrePage';
import { AnimeCategoryPage } from './frontend/pages/AnimeCategoryPage';
import { WatchPage } from './frontend/pages/WatchPage';

function App() {
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);

  return (
    <Router>
      <div className="min-h-screen bg-gray-900">
        <Topbar currentPage={''} key={''} onNavigate={() => {}} />
        <Routes>
          <Route path="/" element={<AnimeHomePage />} />
          <Route path="/anime/:animeId" element={<AnimeDetailsPage />} />
          <Route path="/search" element={<AnimeSearchPage />} />
          <Route path="/genre/:genreName" element={<AnimeGenrePage />} />
          <Route path="/category/:category" element={<AnimeCategoryPage />} />
          <Route path="/watch/:episodeId" element={<WatchPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;