/**
 * This script serves the built files in the `build` directory and handles
 * routing for pages so that URLs without an extension are served as HTML.
 *
 * @module
 */

import { extname, fromFileUrl } from "@std/path";
import { serveDir } from "@std/http";

import { BUILD_PATH } from "utils/consts.ts";

if (import.meta.main) {
  Deno.serve((req) => {
    const url = new URL(req.url);

    // Add .html extension to URLs that don't have an extension
    if (!url.pathname.endsWith("/") && extname(url.pathname) === "") {
      url.pathname += ".html";
      req = new Request(url, req);
    }

    return serveDir(req, { fsRoot: fromFileUrl(BUILD_PATH) });
  });
}
