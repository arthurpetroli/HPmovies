# Reprodução local e encaminhamento da API

O HPmovies agora inicia frontend e backend com `npm run dev`. O encaminhamento `/api` do Vite aponta para `127.0.0.1:4000` (ou a porta `PORT` definida em `.env`), sem depender do antigo backend Koyeb.

O endpoint `/api/v2/hianime/proxy-stream` foi retirado e responde **410** antes de qualquer acesso externo. A implementação anterior aceitava URLs arbitrárias e podia acessar serviços privados, além de encaminhar cabeçalhos artificiais. Os vídeos atuais são URLs autorizadas retornadas pelo provedor de reprodução e carregadas diretamente pelo player.

O vídeo demonstrativo tem HLS e MP4 alternativo. As legendas demonstrativas WebVTT ficam em `public/demo-pt-BR.vtt`, servidas pelo próprio frontend. Nenhum mecanismo de contorno de CORS, autenticação ou restrições de terceiros é necessário para esta experiência.

Veja [README.md](README.md) para executar e [AUDIT.md](AUDIT.md) para o diagnóstico.
