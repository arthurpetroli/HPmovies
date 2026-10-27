/** Byte limit shared by native server captions and legacy browser conversion. */
export const MAX_SUBTITLE_BYTES = 2_000_000;

function timestamp(value: string): { text: string; milliseconds: number } {
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!match || +match[2] > 59 || +match[3] > 59) throw new Error('Tempo de legenda inválido.');
  const fraction = match[4].padEnd(3, '0');
  return {
    text: `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${fraction}`,
    milliseconds: ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(fraction),
  };
}

function cueInterval(start: string, end: string): string {
  const from = timestamp(start), to = timestamp(end);
  if (to.milliseconds <= from.milliseconds) throw new Error('O fim da legenda deve ser posterior ao início.');
  return `${from.text} --> ${to.text}`;
}

/** Plain ASS dialogue is supported; typesetting, karaoke and attachments are not rendered. */
export function subtitleToVtt(input: string, format: 'srt' | 'ass' | 'vtt'): string {
  if (input.length > MAX_SUBTITLE_BYTES || new TextEncoder().encode(input).byteLength > MAX_SUBTITLE_BYTES) throw new Error('A legenda excede o limite de tamanho.');
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (format === 'vtt') {
    if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(text) || text.split('\n', 1)[0].includes('-->')) throw new Error('Arquivo WebVTT inválido.');
    const hasCue = text.split(/\n\s*\n/).slice(1).some(block => {
      const lines = block.split('\n');
      if (/^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0])) return false;
      const index = lines.findIndex(line => line.includes('-->'));
      const interval = lines[index]?.match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
      if (!interval || !lines.slice(index + 1).join('\n').trim()) return false;
      const withHours = (value: string) => value.split(':').length === 2 ? `00:${value}` : value;
      try { cueInterval(withHours(interval[1]), withHours(interval[2])); return true; }
      catch { return false; }
    });
    if (!hasCue) throw new Error('Nenhuma fala válida encontrada na legenda.');
    return text;
  }
  const cues: string[] = [];
  let lastCueError: unknown;
  const addCue = (start: string, end: string, dialogue: string) => {
    if (!dialogue.trim()) return;
    try { cues.push(`${cueInterval(start, end)}\n${dialogue}`); }
    catch (error) { lastCueError = error; }
  };
  if (format === 'srt') {
    for (const block of text.trim().split(/\n\s*\n/)) {
      const lines = block.split('\n');
      if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
      const interval = lines.shift()?.trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
      if (!interval || !lines.length) continue;
      addCue(interval[1], interval[2], lines.join('\n'));
    }
  } else {
    let inEvents = false;
    let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    for (const line of text.split('\n')) {
      if (/^\[/.test(line)) inEvents = /^\[Events\]$/i.test(line.trim());
      if (!inEvents) continue;
      if (/^Format:/i.test(line)) fields = line.slice(line.indexOf(':') + 1).split(',').map(field => field.trim().toLowerCase());
      if (!/^Dialogue:/i.test(line)) continue;
      const values = line.slice(line.indexOf(':') + 1).trim().split(',');
      const textIndex = fields.indexOf('text');
      if (textIndex !== fields.length - 1 || values.length < fields.length) continue;
      const rawDialogue = values.slice(textIndex).join(',');
      // ASS vector drawings have no equivalent in the deliberately textual renderer.
      if (/\{[^}]*\\p[1-9]\d*[^}]*\}/i.test(rawDialogue)) continue;
      const dialogue = rawDialogue.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
      if (!dialogue.trim()) continue;
      const escaped = dialogue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      addCue(values[fields.indexOf('start')] || '', values[fields.indexOf('end')] || '', escaped);
    }
  }
  if (!cues.length) throw lastCueError instanceof Error ? lastCueError : new Error('Nenhuma fala válida encontrada na legenda.');
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
