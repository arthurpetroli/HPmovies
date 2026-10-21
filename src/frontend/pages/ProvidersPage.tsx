import { useCallback, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, Server } from 'lucide-react';
import type { ProviderDiagnostic, ProviderState } from '../../shared/providers';
import { useCatalogRequest } from '../hooks/useCatalogRequest';
import { requestData } from '../services/http';
import { CatalogError, CatalogSkeleton } from '../components/ui/CatalogState';

const states: Record<ProviderState, string> = { available: 'Disponível', unavailable: 'Indisponível', checking: 'Em verificação', empty: 'Sem conteúdo', unauthorized: 'Não autorizado', connection_error: 'Erro de conexão' };
const valid = (value: unknown): value is ProviderDiagnostic[] => Array.isArray(value) && value.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.message === 'string' && typeof item.checkedAt === 'string' && typeof item.enabled === 'boolean' && typeof item.authorized === 'boolean' && typeof item.technicalAvailable === 'boolean' && Object.hasOwn(states, item.state));

export function ProvidersPage() {
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => requestData('/providers', valid), []);
  const { data, loading, error } = useCatalogRequest(`providers:${attempt}`, load);
  return <main id="main-content" className="page-shell content-width"><div className="page-heading"><span className="eyebrow">CONEXÕES DA SUA BIBLIOTECA</span><h1>Disponibilidade das fontes.</h1><p>Consulte quais catálogos e fontes de leitura ou reprodução estão acessíveis.</p></div><button className="button-secondary mb-8" disabled={loading} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />{loading ? 'Em verificação…' : 'Verificar novamente'}</button>{loading ? <CatalogSkeleton count={3} /> : error ? <CatalogError message={error} onRetry={() => setAttempt(value => value + 1)} /> : <div className="provider-grid">{data?.map(provider => <article key={provider.id} className="provider-card"><div className="provider-heading"><span className="state-icon">{provider.state === 'available' ? <CheckCircle2 size={24} /> : <Server size={24} />}</span><span className={`provider-state ${provider.state}`}>{states[provider.state]}</span></div><h2>{provider.name}</h2><p>{provider.message}</p><dl><div><dt>Conexão técnica</dt><dd>{provider.technicalAvailable ? 'Confirmada' : 'Não confirmada'}</dd></div><div><dt>Uso autorizado</dt><dd>{provider.authorized ? 'Sim' : 'Não configurado'}</dd></div></dl><small><Activity size={12} />Verificado às {new Date(provider.checkedAt).toLocaleTimeString('pt-BR')}</small></article>)}</div>}</main>;
}
