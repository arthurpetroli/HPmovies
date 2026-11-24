import 'dotenv/config';

export interface AdultConfig {
  /** Adult routes exist only when the backend operator enables them. */
  enabled: boolean;
}

/** Backend configuration only; never use a VITE_ prefix for this value. */
export function loadAdultConfig(env: NodeJS.ProcessEnv = process.env): AdultConfig {
  const value = env.ADULT_CONTENT_ENABLED?.trim();
  if (value && value !== 'true' && value !== 'false') throw new Error('ADULT_CONTENT_ENABLED deve ser true ou false.');
  return { enabled: value === 'true' };
}
