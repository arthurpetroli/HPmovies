/**
 * Valida e normaliza o ID do anime para o formato esperado pela API
 */
export const normalizeAnimeId = (id: string): string => {
  if (!id) {
    throw new Error('ID do anime não pode ser vazio');
  }

  // Remove espaços em branco
  const cleanId = id.trim();
  
  // Verifica se já está no formato correto (slug-number)
  // Exemplo: one-piece-100
  const slugPattern = /^[a-z0-9-]+-\d+$/;
  
  if (slugPattern.test(cleanId)) {
    return cleanId;
  }

  // Se for apenas um número, lança erro
  if (/^\d+$/.test(cleanId)) {
    throw new Error(`ID inválido: ${cleanId}. O ID deve estar no formato "anime-name-12345"`);
  }

  return cleanId;
};

/**
 * Extrai o ID do anime de uma URL ou path
 */
export const extractAnimeId = (urlOrPath: string): string => {
  const match = urlOrPath.match(/\/([^/]+)$/);
  return match ? match[1] : urlOrPath;
};

/**
 * Formata o nome do anime para slug
 */
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const classNames = (...classes: (string | false | undefined | null)[]): string => {
  return classes.filter(Boolean).join(' ');
};