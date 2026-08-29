import { handleArchiveViewerRequest } from "./lib.js";

export default {
  async fetch(request, env) {
    return handleArchiveViewerRequest(request, env);
  },
};
