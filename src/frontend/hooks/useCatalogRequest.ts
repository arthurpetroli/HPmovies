import { useEffect, useState } from 'react';

interface RequestState<T> { key: string; data: T | null; loading: boolean; error: string }

/** Reset when the request identity changes, and ignore results from an obsolete request. */
export function useCatalogRequest<T>(key: string, loader: () => Promise<T>) {
  const [state, setState] = useState<RequestState<T>>({ key, data: null, loading: true, error: '' });
  if (state.key !== key) setState({ key, data: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    loader().then((data) => {
      if (active) setState({ key, data, loading: false, error: '' });
    }).catch((reason: unknown) => {
      if (active) setState({ key, data: null, loading: false, error: reason instanceof Error ? reason.message : 'Não foi possível carregar os dados. Tente novamente.' });
    });
    return () => { active = false; };
  }, [key, loader]);
  return state.key === key ? state : { key, data: null, loading: true, error: '' };
}
