import vinext from "vinext/server/app-router-entry";
import { handleApi } from "../server/api.mjs";

interface Env {
  DB: D1Database;
  INGEST_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await handleApi(request, env);
    if (response) return response;
    return vinext.fetch(request);
  },
};
