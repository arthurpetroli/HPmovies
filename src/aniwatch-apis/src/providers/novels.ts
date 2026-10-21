import type { NovelChapter, NovelChapterList, NovelPage, NovelProvider, NovelQuery, NovelReadingResult, NovelTitle } from '../../../shared/novel.js';
import { ApiError } from '../config/apiError.js';
import { AniwatchAPICache, cache } from '../config/cache.js';
import { runtimeConfig } from '../config/runtime.js';

const FIELDS = `id type format isAdult title { romaji english native }
  coverImage { extraLarge large } bannerImage description(asHtml: false)
  averageScore startDate { year } status genres chapters volumes`;
const SEARCH = `query NovelSearch($search: String, $genre: String, $status: MediaStatus,
  $sort: [MediaSort], $page: Int, $dateStart: FuzzyDateInt, $dateEnd: FuzzyDateInt) {
  Page(page: $page, perPage: 24) {
    pageInfo { currentPage hasNextPage total }
    media(type: MANGA, format: NOVEL, isAdult: false, search: $search, genre: $genre,
      status: $status, sort: $sort, startDate_greater: $dateStart, startDate_lesser: $dateEnd) { ${FIELDS} }
  }
}`;
const DETAILS = `query NovelDetails($id: Int) {
  Media(id: $id, type: MANGA, format: NOVEL, isAdult: false) {
    ${FIELDS}
    externalLinks { site url }
    staff(perPage: 12) { edges { role node { name { full } } } }
  }
}`;
const SORTS = { popular: 'POPULARITY_DESC', score: 'SCORE_DESC', trending: 'TRENDING_DESC', newest: 'START_DATE_DESC' };
const STATUSES = new Set(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']);

export function validateNovelId(id: string) {
  if (id !== 'demo' && !/^[1-9]\d{0,8}$/.test(id)) throw new ApiError(400, 'INVALID_NOVEL_ID', 'O identificador da novel deve ser um número positivo do AniList.');
  return id;
}

export function validateNovelQuery(params: Record<string, string>): NovelQuery {
  const allowed = new Set(['search', 'genre', 'year', 'status', 'sort', 'page']);
  if (Object.keys(params).some((key) => !allowed.has(key))) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Filtro de novels desconhecido.');
  const query: NovelQuery = {};
  for (const field of ['search', 'genre'] as const) {
    const value = params[field]?.trim();
    if (value && (value.length > (field === 'search' ? 120 : 50) || [...value].some((character) => character.charCodeAt(0) < 32))) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'O filtro contém caracteres inválidos ou é longo demais.');
    if (value) query[field] = value;
  }
  for (const [field, min, max] of [['year', 1900, 2100], ['page', 1, 1000]] as const) {
    if (params[field]) {
      const value = Number(params[field]);
      if (!/^\d+$/.test(params[field]) || !Number.isInteger(value) || value < min || value > max) throw new ApiError(400, 'INVALID_NOVEL_FILTER', `Valor inválido para ${field}.`);
      query[field] = value;
    }
  }
  if (params.status) {
    if (!STATUSES.has(params.status)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Status de novel inválido.');
    query.status = params.status;
  }
  if (params.sort) {
    if (!Object.prototype.hasOwnProperty.call(SORTS, params.sort)) throw new ApiError(400, 'INVALID_NOVEL_FILTER', 'Ordenação inválida.');
    query.sort = params.sort as NovelQuery['sort'];
  }
  return query;
}

function invalid(): never { throw new ApiError(502, 'INVALID_NOVEL_RESPONSE', 'O catálogo de novels respondeu com dados inválidos. Tente novamente.'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function safeUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}

/** The same deadline covers response headers and streaming the JSON body. */
async function readPayload(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) return invalid();
  const reader = response.body.getReader();
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((resolve, reject) => { void resolve; rejectAbort = reject; });
  const abort = () => rejectAbort(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0, body = '';
  try {
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2_000_000) throw new ApiError(502, 'NOVEL_RESPONSE_TOO_LARGE', 'O catálogo respondeu com dados além do limite permitido.');
      body += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export function normalizeNovel(value: unknown): NovelTitle {
  const media = record(value);
  const titles = record(media.title);
  const title = text(titles.english) ?? text(titles.romaji) ?? text(titles.native);
  const id = number(media.id);
  if (!id || !Number.isInteger(id) || !title || media.type !== 'MANGA' || media.format !== 'NOVEL' || media.isAdult !== false) return invalid();
  const cover = media.coverImage ? record(media.coverImage) : {};
  const date = media.startDate ? record(media.startDate) : {};
  const edges = media.staff ? record(media.staff).edges : undefined;
  const authors = Array.isArray(edges) ? edges.flatMap((value) => {
    if (!value) return [];
    const edge = record(value);
    if (!text(edge.role)?.toLowerCase().includes('story') || !edge.node) return [];
    const name = record(edge.node).name;
    return name && text(record(name).full) ? [text(record(name).full)!] : [];
  }) : [];
  return {
    id: String(id), title, titleOriginal: text(titles.romaji) ?? text(titles.native),
    poster: safeUrl(cover.extraLarge) ?? safeUrl(cover.large) ?? '', banner: safeUrl(media.bannerImage),
    description: text(media.description)?.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 6000),
    year: number(date.year), score: number(media.averageScore), status: text(media.status),
    genres: Array.isArray(media.genres) ? media.genres.filter((genre): genre is string => typeof genre === 'string') : [],
    volumes: number(media.volumes), chapterCount: number(media.chapters), authors: [...new Set(authors)],
    externalLinks: Array.isArray(media.externalLinks) ? media.externalLinks.flatMap((value) => {
      if (!value) return [];
      const link = record(value), url = safeUrl(link.url), site = text(link.site);
      return url && site ? [{ url, site }] : [];
    }) : [],
  };
}

const DEMO: NovelTitle = {
  id: 'demo', title: 'O farol das pequenas histórias', poster: '', genres: ['Adventure', 'Fantasy'],
  description: 'Uma breve história original do HPmovies para experimentar o leitor. Não pertence ao catálogo do AniList e não reproduz uma light novel publicada.',
  authors: ['HPmovies · texto demonstrativo original'], isDemo: true, chapterCount: 3, status: 'FINISHED',
};
const DEMO_CHAPTERS: Array<NovelChapter & { paragraphs: string[] }> = [
  { id: '1', number: 1, title: 'A luz que faltava', language: 'pt-br', paragraphs: [
    'Todas as noites, quando o último barco desaparecia atrás da curva do rio, Lia acendia o farol da vila. Não era uma torre imponente: apenas uma casa estreita de janelas redondas, construída sobre uma colina, com uma lâmpada grande no último andar. Ainda assim, os viajantes diziam que aquela luz parecia saber o nome de quem procurava o caminho de volta.',
    'Lia não conhecia magia. Conhecia escadas que rangiam, vidros embaçados e o peso exato de um balde de água. Conhecia também o silêncio que ficava depois que seu avô terminava uma história. Era ele quem cuidava do farol antes dela, e era por causa dele que havia tantos livros nas prateleiras da casa.',
    'Naquela quinta-feira, porém, a lâmpada não acendeu. Lia verificou os fios, limpou o vidro e girou a chave uma segunda vez. Nada. Lá embaixo, o rio continuava escuro. Um barco demorava a encontrar o cais, e os moradores começavam a abrir as portas para olhar a colina.',
    'Foi então que uma folha caiu de um livro antigo. Não havia um mapa nem uma fórmula secreta. Havia uma lista escrita com a letra torta de seu avô: pão para dona Rosa, botão para o casaco de Bento, uma visita à oficina de Nilo. No rodapé, apenas uma frase: toda luz começa em algum lugar pequeno.',
    'Lia colocou a folha no bolso e desceu até a vila. Dona Rosa estava na cozinha, tentando alcançar um pote na prateleira mais alta. Lia ajudou e ficou para amassar o pão. Enquanto esperavam o forno aquecer, a senhora contou sobre a primeira viagem que fizera pelo rio, antes mesmo de o farol existir.',
    'Ao sair, Lia percebeu um brilho miúdo junto à costura do bolso. A folha parecia guardar o calor do forno. Ela a examinou contra a lua, mas não havia nada além do papel gasto. Guardou-a com cuidado e foi procurar Bento.',
    'O casaco do menino realmente precisava de um botão. Lia não sabia costurar muito bem; o primeiro ponto ficou torto, e os dois riram. Bento contou que queria construir um barco amarelo e navegar até a nascente. O segundo ponto saiu melhor, e o terceiro ficou firme o bastante para enfrentar qualquer vento.',
    'Quando voltou à rua, duas pequenas luzes acompanhavam Lia. Não iluminavam o caminho inteiro, apenas o próximo passo. Talvez fosse tudo de que ela precisava. A oficina de Nilo estava no fim da ladeira, e uma tira de claridade escapava por baixo da porta.',
    'Nilo ouviu o problema da lâmpada sem interromper. Depois abriu uma gaveta e encontrou uma peça embrulhada em tecido. Seu avô deixou isto aqui há muitos anos, disse. Pediu que eu guardasse até você aparecer. Lia segurou a peça com as duas mãos. Era simples, pequena e pesada como uma promessa cumprida.',
    'Ao subir de volta para casa, ela já não estava sozinha. Dona Rosa levava pão, Bento carregava uma caixa de ferramentas e Nilo vinha atrás, resmungando sobre a falta de corrimão. O farol continuava apagado. Mas, pela primeira vez naquela noite, Lia enxergou claramente o caminho até a porta.',
  ] },
  { id: '2', number: 2, title: 'Uma escada para o céu', language: 'pt-br', paragraphs: [
    'A peça de Nilo se encaixou atrás da lâmpada com um estalo discreto. Todos prenderam a respiração. Lia girou a chave, e o farol respondeu com uma faísca azul, breve como um piscar de olhos. Depois voltou a se apagar. Bento suspirou tão alto que dona Rosa lhe ofereceu um pedaço de pão para ocupar a boca.',
    'Nilo se ajoelhou perto da máquina. A peça está boa, disse. O problema está mais acima. Apontou para uma passagem no teto que Lia nunca havia reparado. Era estreita, escondida pelas vigas e fechada com uma tampa de madeira. Havia uma escada dobrada ao lado, coberta de poeira.',
    'Lia subiu levando uma lanterna. Acima da sala da lâmpada existia um pequeno observatório. O teto de vidro estava coberto por folhas, e uma engrenagem ligava o telescópio ao coração do farol. Ao lado do aparelho, um caderno permanecia aberto numa página marcada por uma flor seca.',
    'O avô desenhara as estrelas como quem desenha vizinhos. Aquela é a estrela apressada, dizia uma anotação. Esta outra só aparece para quem espera. Lia sorriu, mas o sorriso logo se tornou saudade. Sentou-se no chão por um momento, ouvindo as vozes dos amigos que conversavam no andar de baixo.',
    'No fim da página havia outra instrução: olhe com atenção para aquilo que sempre esteve aqui. Lia ergueu a lanterna. As folhas sobre o vidro não eram a causa da escuridão. Uma pequena alavanca estava presa atrás de uma viga, escondida por um ninho abandonado. Ela a puxou devagar.',
    'O teto se abriu em duas metades. O ar noturno entrou, trazendo o cheiro do rio. As engrenagens começaram a girar, primeiro com dificuldade, depois com uma cadência tranquila. Lá embaixo, Bento gritou que a lâmpada estava brilhando. Não muito, mas o suficiente para iluminar as mãos de quem estava ao redor.',
    'Lia olhou pelo telescópio e não encontrou nenhuma estrela. Encontrou o reflexo da própria vila: as janelas, o cais, a oficina de Nilo. A lente apontava para o rio. E, no centro do rio, um pequeno barco amarelo estava parado, sem conseguir distinguir as margens.',
    'Não era o barco de Bento, é claro. Era o de uma viajante que trazia tecidos de uma cidade distante. Lia ajustou a lente até ver a passageira erguer uma lanterna, pedindo orientação. O farol ganhou força. Uma faixa dourada cruzou a água e alcançou a embarcação.',
    'Quando a viajante encontrou o cais, todos foram recebê-la. Ela se apresentou como Mara e contou que seguira a luz desde a curva mais afastada. Nunca tinha visto um farol tão acolhedor, disse. Lia percebeu que a folha no bolso já não brilhava. O calor havia encontrado outro lugar para ficar.',
    'Naquela noite, ninguém voltou para casa cedo. Mara dividiu frutas da viagem; dona Rosa cortou o resto do pão. Bento desenhou seu barco futuro numa caixa de papelão, e Nilo finalmente admitiu que gostava de histórias. Lia ficou ouvindo, enquanto a luz do farol seguia firme sobre o rio.',
  ] },
  { id: '3', number: 3, title: 'Histórias para amanhã', language: 'pt-br', paragraphs: [
    'Na manhã seguinte, Lia encontrou uma fila pequena diante do farol. Não eram pessoas com máquinas quebradas. Eram vizinhos com histórias: a do peixe que escapou por pouco, a da carta recebida depois de vinte anos, a do jardim que florescera fora de época. Bento segurava um caderno novo.',
    'Podemos guardar as histórias aqui, perguntou ele. Para quem chegar depois. Lia olhou para as prateleiras cheias e pensou em seu avô. Durante muito tempo, acreditara que cuidar do farol significava apenas manter uma lâmpada acesa. Agora começava a entender por que a casa precisava de tantos livros.',
    'Arrumaram uma mesa perto da janela. Dona Rosa trouxe cadeiras de sua cozinha. Nilo instalou o corrimão na escada, depois fingiu que não havia sido ideia sua. Mara deixou um tecido azul para cobrir a mesa e prometeu voltar com relatos de outras margens.',
    'Cada pessoa escolheu como contar. Algumas escreveram páginas inteiras. Outras desenharam. Um pescador deixou apenas uma frase, porque dizia que as palavras grandes demais assustavam os peixes. Lia guardou tudo com o mesmo cuidado, sem medir o tamanho de uma lembrança pelo número de linhas.',
    'À tarde, uma criança que Lia ainda não conhecia ficou parada na porta. Não tenho história nenhuma, disse. Lia ofereceu uma cadeira. Então podemos começar uma agora. As duas ficaram olhando o rio até que uma nuvem pareceu um dragão, depois uma chaleira e, por fim, uma nuvem outra vez.',
    'Quando a criança foi embora, havia uma página nova no caderno: hoje conheci uma pessoa que sabe esperar as nuvens mudarem de ideia. Lia leu duas vezes antes de fechar o livro. A frase era pequena, mas a sala pareceu ganhar uma janela a mais.',
    'O tempo passou. O barco de Bento começou como um desenho, tornou-se uma coleção de tábuas e acabou ganhando uma vela amarela. O farol precisou de reparos em muitos outros dias. Nenhuma peça se consertou por mágica. Houve ferramentas perdidas, chuva nas escadas e noites em que todos ficaram cansados.',
    'Mesmo assim, sempre aparecia alguém. Às vezes para ajudar com a máquina. Às vezes para levar uma xícara de chá. Lia aprendeu que a luz não exigia grandes aventuras. Exigia atenção, paciência e a coragem modesta de bater à porta de outra pessoa.',
    'Na primeira viagem de Bento, a vila inteira esperou no cais. Seu barco amarelo seguiu até a curva do rio e desapareceu atrás das árvores. À noite, quando ele voltou, o farol já estava aceso. Lia acenou da janela redonda, com um caderno em branco debaixo do braço.',
    'E quando o menino começou a contar o que havia visto, ninguém lhe perguntou se a viagem tinha sido longa o bastante para virar uma história. Todos apenas chegaram um pouco mais perto. No alto da colina, a luz continuou girando, levando para cada margem a promessa simples de um caminho de volta. Fim.',
  ] },
];
const UNAVAILABLE = 'Os metadados vêm do AniList. Os capítulos dependem de uma fonte de texto com permissão de distribuição validada; nenhuma fonte desse tipo está configurada.';

interface NovelOptions { fetcher?: typeof fetch; cache?: AniwatchAPICache; timeoutMs?: number; endpoint?: string }
export class AniListNovelProvider implements NovelProvider {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniwatchAPICache;
  private readonly timeoutMs: number;
  private readonly endpoint: string;
  constructor(options: NovelOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? cache;
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.endpoint = options.endpoint ?? runtimeConfig.anilistUrl;
  }

  private async request(query: string, variables: Record<string, unknown> = {}) {
    let response: Response;
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      response = await this.fetcher(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }), signal });
    } catch (error) {
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new ApiError(504, 'NOVEL_TIMEOUT', 'O catálogo de novels demorou a responder. Tente novamente.');
      throw new ApiError(503, 'NOVEL_UNAVAILABLE', 'Não foi possível conectar ao AniList. Tente novamente.');
    }
    if (response.status === 429) throw new ApiError(503, 'NOVEL_RATE_LIMIT', 'O AniList está limitando as consultas. Aguarde um momento.', Math.min(3600, Math.max(1, Number(response.headers.get('Retry-After')) || 60)));
    if (response.status === 404) throw new ApiError(404, 'NOVEL_NOT_FOUND', 'Novel não encontrada no catálogo.');
    if (!response.ok) throw new ApiError(502, 'NOVEL_UPSTREAM_ERROR', 'O AniList está indisponível no momento.');
    let payload: Record<string, unknown>;
    try { payload = record(await readPayload(response, signal)); } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal.aborted || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new ApiError(504, 'NOVEL_TIMEOUT', 'O catálogo de novels demorou a responder. Tente novamente.');
      return invalid();
    }
    if (Array.isArray(payload.errors) && payload.errors.length) {
      if (payload.errors.some((error) => error && typeof error === 'object' && 'status' in error && error.status === 404)) throw new ApiError(404, 'NOVEL_NOT_FOUND', 'Novel não encontrada no catálogo.');
      throw new ApiError(502, 'NOVEL_UPSTREAM_ERROR', 'Não foi possível consultar o catálogo de novels.');
    }
    return record(payload.data);
  }

  search(input: NovelQuery): Promise<NovelPage> {
    const query = validateNovelQuery(Object.fromEntries(Object.entries(input).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])));
    const variables = {
      ...(query.search ? { search: query.search } : {}), ...(query.genre ? { genre: query.genre } : {}),
      ...(query.status ? { status: query.status } : {}), sort: [SORTS[query.sort ?? 'popular']], page: query.page ?? 1,
      ...(query.year ? { dateStart: query.year * 10000 + 100, dateEnd: query.year * 10000 + 1232 } : {}),
    };
    return this.cache.getOrSet(async () => {
      const data = await this.request(SEARCH, variables), page = record(data.Page), info = record(page.pageInfo);
      if (!Array.isArray(page.media) || !Number.isInteger(info.currentPage) || Number(info.currentPage) < 1 || typeof info.hasNextPage !== 'boolean') return invalid();
      return { items: page.media.filter((item) => item !== null).map(normalizeNovel), page: Number(info.currentPage), hasNextPage: info.hasNextPage, total: number(info.total) };
    }, `novel:anilist:search:${JSON.stringify(variables)}`, 300);
  }

  genres(): Promise<string[]> {
    return this.cache.getOrSet(async () => {
      const data = await this.request('query NovelGenres { GenreCollection }');
      if (!Array.isArray(data.GenreCollection) || !data.GenreCollection.every((genre) => typeof genre === 'string')) return invalid();
      return (data.GenreCollection as string[]).filter((genre) => genre !== 'Hentai').sort();
    }, 'novel:anilist:genres', 86400);
  }

  details(id: string): Promise<NovelTitle> {
    validateNovelId(id);
    if (id === 'demo') return Promise.resolve({ ...DEMO });
    return this.cache.getOrSet(async () => {
      const data = await this.request(DETAILS, { id: Number(id) });
      if (!data.Media) throw new ApiError(404, 'NOVEL_NOT_FOUND', 'Novel não encontrada no catálogo.');
      return normalizeNovel(data.Media);
    }, `novel:anilist:details:${id}`, 3600);
  }

  chapters(id: string): Promise<NovelChapterList> {
    validateNovelId(id);
    if (id === 'demo') return Promise.resolve({ available: true, status: 'available', providerId: 'hpmovies-original', message: 'Texto demonstrativo original do HPmovies, em português.', chapters: DEMO_CHAPTERS.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.title, language: chapter.language })) });
    return Promise.resolve({ available: false, status: 'not_authorized', providerId: 'unconfigured', message: UNAVAILABLE, chapters: [] });
  }

  content(id: string, chapterId: string): Promise<NovelReadingResult> {
    validateNovelId(id);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(chapterId)) throw new ApiError(400, 'INVALID_NOVEL_CHAPTER', 'Identificador de capítulo inválido.');
    if (id !== 'demo') return Promise.resolve({ available: false, status: 'not_authorized', providerId: 'unconfigured', message: UNAVAILABLE, paragraphs: [] });
    const index = DEMO_CHAPTERS.findIndex((chapter) => chapter.id === chapterId);
    if (index === -1) throw new ApiError(404, 'NOVEL_CHAPTER_NOT_FOUND', 'Capítulo demonstrativo não encontrado.');
    const { paragraphs, ...chapter } = DEMO_CHAPTERS[index];
    return Promise.resolve({ available: true, status: 'available', providerId: 'hpmovies-original', message: 'Demonstração com texto original, criado para testar este leitor.', novel: { ...DEMO }, chapter, paragraphs: [...paragraphs], previousChapterId: DEMO_CHAPTERS[index - 1]?.id, nextChapterId: DEMO_CHAPTERS[index + 1]?.id, isDemo: true, attribution: 'Texto original do HPmovies. Disponível como demonstração do leitor; não é um capítulo de terceiros.' });
  }
}
