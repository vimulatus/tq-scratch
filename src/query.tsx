import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";

export class QueryClient {
  queries: Query[];

  constructor() {
    this.queries = [];
  }

  getQuery(options: QueryOptions) {
    const queryHash = JSON.stringify(options.queryKey);
    let query = this.queries.find((d) => d.queryHash === queryHash);

    if (!query) {
      query = createQuery(this, options);
      this.queries.push(query);
    }

    return query;
  }
}

const context = createContext<QueryClient | null>(null);

export function QueryClientProvider({
  children,
  client,
}: {
  children: ReactNode;
  client: QueryClient;
}) {
  return <context.Provider value={client}>{children}</context.Provider>;
}

type QueryState<TData = unknown> = {
  status: "loading" | "error" | "success";
  isFetching: boolean;
  data?: TData;
  error?: unknown;
};

type Updater<TData> = (state: QueryState<TData>) => QueryState<TData>;

type Query<TData = unknown> = {
  queryKey: unknown;
  queryHash: string;
  promise: null | Promise<void>;
  state: QueryState<TData>;
  setState: (updater: Updater<TData>) => void;
  fetch: () => void;
  subscribers: QueryObserver[];
  subsribe: (subscriber: QueryObserver) => () => void; // this returns an unsubscribe function
};

type QueryOptions<TData = unknown> = {
  queryKey: unknown[];
  queryFn: () => Promise<TData>;
};

type QueryObserver<TData = unknown> = {
  notify: () => void;
  getResult: () => QueryState<TData>;
  subscribe: (cb: () => void) => () => void;
};

function createQueryObserver(
  client: QueryClient,
  { queryKey, queryFn }: QueryOptions,
) {
  const query = client.getQuery({ queryKey, queryFn });

  const observer: QueryObserver = {
    notify: () => {},
    getResult: () => query.state,
    subscribe: (callback) => {
      observer.notify = callback;
      const unsubscribe = query.subsribe(observer);

      query.fetch();

      return unsubscribe;
    },
  };

  return observer;
}

function createQuery<TData>(
  client: QueryClient,
  { queryKey, queryFn }: QueryOptions<TData>,
): Query<TData> {
  let query: Query<TData> = {
    queryKey,
    queryHash: JSON.stringify(queryKey),
    promise: null,
    subscribers: [],
    state: {
      status: "loading",
      isFetching: true,
      data: undefined,
      error: undefined,
    },
    fetch: () => {
      // this solves deduplication
      if (!query.promise) {
        query.promise = (async () => {
          query.setState((old) => ({
            ...old,
            isFetching: true,
            error: undefined,
          }));

          try {
            const data = await queryFn();
            query.setState((old) => ({
              ...old,
              status: "success",
              data,
            }));
          } catch (error) {
            query.setState((old) => ({
              ...old,
              status: "error",
              error,
            }));
          } finally {
            query.promise = null;
            query.setState((old) => ({
              ...old,
              isFetching: false,
            }));
          }
        })();
      }

      return query.promise;
    },
    setState: (updater) => {
      query.state = updater(query.state);
      query.subscribers.forEach((sub) => sub.notify());
    },
    subsribe: (subscriber) => {
      query.subscribers.push(subscriber);

      return () => {
        query.subscribers = query.subscribers.filter(
          (sub) => sub !== subscriber,
        );
      };
    },
  };

  return query;
}

export function useQuery({ queryKey, queryFn }: QueryOptions) {
  const client = useContext(context);

  if (!client) {
    throw new Error();
  }

  const [, rerender] = useReducer((i) => i + 1, 0);

  const observerRef = useRef<QueryObserver | null>(null);

  if (!observerRef.current) {
    observerRef.current = createQueryObserver(client, {
      queryKey,
      queryFn,
    });
  }

  useEffect(() => {
    // if anything changes in the observer, we rerender the hook
    return observerRef.current?.subscribe(rerender);
  }, []);

  return observerRef.current.getResult();
}
