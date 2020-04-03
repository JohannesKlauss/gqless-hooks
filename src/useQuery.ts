import { Client, ObjectNode } from 'gqless';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import {
  IState,
  EarlyInitialState,
  LazyInitialState,
  Maybe,
  NoCacheMergeWarn,
  StateReducer,
  useFetchCallback,
  CreateOptions,
  QueryOptions,
  timeoutError,
  FetchPolicy,
} from './common';

export type QueryFn<TData, Query> = (schema: Client<Query>['query']) => TData;

type QueryCallback<TData, Query> = (
  queryFnArg?: QueryFn<TData, Query>,
  fetchPolicy?: FetchPolicy
) => Promise<Maybe<TData>>;

const defaultOptions = <TData>(options: QueryOptions<TData>) => {
  const {
    lazy = false,
    fetchPolicy = 'cache-and-network',
    fetchTimeout = 10000,
    ...rest
  } = options;
  return { lazy, fetchPolicy, fetchTimeout, ...rest };
};

export const createUseQuery = <
  Query,
  Schema extends { Query: ObjectNode } = { Query: ObjectNode }
>({
  endpoint,
  schema,
}: CreateOptions<Schema>) => <TData = unknown>(
  queryFn: QueryFn<TData, Query>,
  options: QueryOptions<TData> = {}
): [IState & { data: Maybe<TData> }, QueryCallback<TData, Query>] => {
  const optionsRef = useRef(options);
  const { lazy, fetchPolicy } = (optionsRef.current = defaultOptions(options));

  const isMountedRef = useRef(false);

  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const [data, setData] = useState<Maybe<TData>>();
  const [state, dispatch] = useReducer(
    StateReducer,
    lazy ? LazyInitialState : EarlyInitialState
  );

  const fetchQuery = useFetchCallback(dispatch, endpoint, fetchPolicy);

  const initialQueryClient = useMemo(
    () => new Client<Query>(schema.Query, fetchQuery),
    [fetchQuery]
  );

  const queryClient = useRef<Client<Query>>(initialQueryClient);

  const queryCallback = useCallback<QueryCallback<TData, Query>>(
    async (
      query = queryFnRef.current,
      fetchPolicy = optionsRef.current.fetchPolicy
    ) => {
      let client: Client<Query> = queryClient.current;

      let val: Maybe<TData> = null;

      if (fetchPolicy !== 'network-only') {
        val = query(client.query);
      }

      if (
        fetchPolicy === 'network-only' ||
        client.scheduler.commit.accessors.size === 0
      ) {
        switch (fetchPolicy) {
          case 'no-cache':
          case 'network-only':
          case 'cache-and-network': {
            client = new Client<Query>(schema.Query, fetchQuery);
            queryClient.current = client;
            query(client.query);

            await new Promise((resolve, reject) => {
              const timeoutReject = setTimeout(() => {
                reject(timeoutError);
              }, optionsRef.current.fetchTimeout);

              client.scheduler.commit.onFetched(() => {
                clearTimeout(timeoutReject);

                resolve();
              });
            });

            val = query(client.query);

            break;
          }
          default: {
            break;
          }
        }
      }

      setData(val);

      return val;
    },
    [queryClient, setData, fetchQuery, queryFnRef, optionsRef]
  );

  if (!isMountedRef.current && !lazy) {
    queryCallback().catch((error) => {
      console.error(error);
    });
  }

  useEffect(() => {
    isMountedRef.current = true;

    if (process.env.NODE_ENV !== 'production') {
      switch (fetchPolicy) {
        case 'cache-only':
        case 'cache-first': {
          console.warn(NoCacheMergeWarn);
          break;
        }

        default: {
          break;
        }
      }
    }
  }, [fetchPolicy]);

  return useMemo(() => [{ ...state, data }, queryCallback], [
    queryCallback,
    state,
    data,
  ]);
};
