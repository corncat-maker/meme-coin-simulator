export type ControllerInput<
  TBody = unknown,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
  TParams extends Record<string, string> = Record<string, string>,
> = {
  action: string;
  operationId: string;
  params: TParams;
  query: TQuery;
  body: TBody;
  rawBody: string | null;
  headers: Record<string, string>;
  request: {
    method: string;
    path: string;
    query: TQuery;
    headers: Record<string, string>;
    body: TBody;
    rawBody: string | null;
  };
};

export type ControllerAction<TInput = ControllerInput, TResult = unknown> = (input: TInput) => Promise<TResult> | TResult;
