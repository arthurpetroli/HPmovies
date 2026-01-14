# Correção do Player de Vídeo - Streaming HLS

## 🎯 Problema Resolvido

O player não conseguia reproduzir streams HLS (m3u8) mesmo com links válidos devido a restrições de CORS e header `Referer`.

## ✅ Solução Implementada

Criado um **proxy no backend** que:

1. Recebe requisições do frontend
2. Adiciona os headers necessários (`Referer`, `Origin`, etc.)
3. Faz a requisição ao servidor de origem
4. Retorna o conteúdo ao player

### Arquivos Modificados

1. **[src/aniwatch-apis/src/routes/hianime.ts](src/aniwatch-apis/src/routes/hianime.ts)** - Nova rota `/api/v2/hianime/proxy-stream`
2. **[src/frontend/components/player/VideoPlayer.tsx](src/frontend/components/player/VideoPlayer.tsx)** - Atualizado para usar o proxy
3. **[.env.example](.env.example)** - Documentação das variáveis de ambiente
4. **[.gitignore](.gitignore)** - Adicionado `.env`

## 🚀 Como Usar

### 1. Configurar variável de ambiente (opcional)

```bash
cp .env.example .env
# Edite .env se necessário (padrão: http://localhost:4000)
```

### 2. Iniciar o backend

```bash
cd src/aniwatch-apis
npm install
npm run dev
```

O backend estará rodando em `http://localhost:4000`

### 3. Iniciar o frontend

Em outro terminal:

```bash
npm install
npm run dev
```

O frontend estará rodando em `http://localhost:5173`

## 🔧 Como Funciona

### Antes (❌ Não funcionava)

```
Frontend → [Bloqueia CORS] → Servidor MegaCloud
```

### Depois (✅ Funciona)

```
Frontend → Backend Proxy → [Headers corretos] → Servidor MegaCloud
```

### Fluxo Técnico

1. **VideoPlayer** detecta URL m3u8
2. Cria URL do proxy: `/api/v2/hianime/proxy-stream?url=<encoded_m3u8_url>`
3. **Backend** recebe a requisição
4. Adiciona headers:
   - `Referer: https://megacloud.blog/`
   - `User-Agent: Mozilla/5.0...`
   - `Origin: https://megacloud.blog`
5. Busca o conteúdo do servidor original
6. Para arquivos m3u8, reescreve URLs internas para também passarem pelo proxy
7. Retorna o conteúdo com headers CORS corretos

## 📝 Exemplo de Uso

```typescript
// O VideoPlayer automaticamente usa o proxy
<VideoPlayer
  src="https://do.netmagcdn.com/.../master.m3u8"
  isM3U8={true}
  subtitles={subtitles}
/>
```

Internamente será convertido para:

```
http://localhost:4000/api/v2/hianime/proxy-stream?url=https%3A%2F%2Fdo.netmagcdn.com%2F...%2Fmaster.m3u8
```

## 🔍 Debugging

Se o vídeo ainda não funcionar, verifique:

1. **Backend rodando?**

   ```bash
   curl http://localhost:4000/health
   ```

2. **Console do browser**

   - Abra DevTools (F12)
   - Procure por erros na aba Console
   - Verifique as requisições na aba Network

3. **Logs do backend**
   - Erros de proxy aparecem no terminal do backend

## 🌐 Produção

Em produção, configure a variável de ambiente:

```bash
VITE_API_BASE_URL=https://seu-backend.com
```

## 📚 Referências

- [HLS.js Documentation](https://github.com/video-dev/hls.js/)
- [CORS Issues with Video Streaming](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Referer Header Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer)
