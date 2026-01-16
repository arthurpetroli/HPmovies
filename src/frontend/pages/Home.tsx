import React from 'react';
import { PlayCircle, Calendar, Star } from 'lucide-react';
// Importe seus componentes existentes aqui (ex: AnimeCard, HeroSlider)
// import AnimeCard from '../components/AnimeCard';

export const Home = () => {
  return (
    <div className="bg-[#0f0f0f] min-h-screen text-gray-200 font-sans">
      {/* 1. Hero Slider (Carrossel de Destaques) */}
      <section className="relative h-[400px] md:h-[500px] w-full bg-gray-900 mb-8">
        {/* Substitua esta div pelo seu componente de Slider existente */}
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <h2 className="text-4xl font-bold text-white mb-2">Destaque da Temporada</h2>
            <p>Slider Component Here</p>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4">src/frontend
        
        {/* 2. Seção de Tendências (Trending) */}
        <section className="mb-10">
          <h3 className="text-[#ffbade] text-xl font-bold mb-4 uppercase tracking-wide">Tendências</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {/* Mapeie seus animes de tendência aqui */}
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-gray-800 aspect-[2/3] rounded-md animate-pulse"></div>
            ))}
          </div>
        </section>

        {/* Layout de Duas Colunas: Principal vs Sidebar */}
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Coluna Principal (Esquerda) */}
          <div className="lg:w-3/4">
            <section className="mb-8">
              <div className="flex justify-between items-end mb-6 border-b border-gray-800 pb-2">
                <h3 className="text-[#ffbade] text-2xl font-bold">Últimos Episódios</h3>
                <button className="text-sm text-gray-400 hover:text-white transition">Ver Todos</button>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {/* Mapeie seus episódios recentes aqui */}
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="group relative">
                    <div className="aspect-video bg-gray-800 rounded-md overflow-hidden mb-2">
                      {/* Imagem do Anime */}
                      <div className="w-full h-full group-hover:scale-105 transition-transform duration-300 bg-gray-700"></div>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
                        <PlayCircle className="text-[#ffbade]" size={40} />
                      </div>
                    </div>
                    <h4 className="font-semibold text-white truncate group-hover:text-[#ffbade]">Nome do Anime {i}</h4>
                    <p className="text-xs text-gray-400">Episódio {i}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Coluna Lateral (Direita) - Sidebar */}
          <div className="lg:w-1/4 space-y-8">
            
            {/* Top 10 */}
            <div className="bg-[#201f31] p-4 rounded-lg">
              <h3 className="text-white text-lg font-bold mb-4 border-l-4 border-[#ffbade] pl-3">Top 10 Animes</h3>
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex gap-3 items-center border-b border-gray-700 pb-2 last:border-0">
                    <span className={`text-xl font-bold ${i < 4 ? 'text-[#ffbade]' : 'text-gray-500'}`}>{i}</span>
                    <div className="h-12 w-10 bg-gray-700 rounded-sm flex-shrink-0"></div>
                    <div className="flex-1 min-w-0">
                      <h5 className="text-sm font-medium text-white truncate hover:text-[#ffbade] cursor-pointer">Anime Popular {i}</h5>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Star size={10} /> 9.8</span>
                        <span className="flex items-center gap-1"><Calendar size={10} /> 2024</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gêneros */}
            <div className="bg-[#201f31] p-4 rounded-lg">
              <h3 className="text-white text-lg font-bold mb-4 border-l-4 border-[#ffbade] pl-3">Gêneros</h3>
              <div className="flex flex-wrap gap-2">
                {['Ação', 'Aventura', 'Comédia', 'Drama', 'Fantasia', 'Magia', 'Sci-Fi', 'Shounen'].map((genre) => (
                  <span key={genre} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded cursor-pointer transition">
                    {genre}
                  </span>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};