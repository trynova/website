/**
 * This script serves the built files in the `build` directory and handles
 * routing for pages so that URLs without an extension are served as HTML.
 *
 * @module
 */

import { fromFileUrl } from "@std/path";
import { serveFile } from "@std/http";

import { BUILD_PATH } from "utils/consts.ts";

async function tryStat(path: string) {
  try {
    return await Deno.stat(fromFileUrl(path));
    // deno-lint-ignore no-empty
  } catch {}
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    const url = new URL(req.url);

    let path: string, stat;

    path = BUILD_PATH + url.pathname;
    stat = await tryStat(path);

    if (!stat?.isFile && !url.pathname.endsWith("/")) {
      if (!stat?.isFile) {
        path = BUILD_PATH + url.pathname + ".html";
        stat = await tryStat(path);
      }

      if (!stat?.isFile) {
        path = BUILD_PATH + url.pathname + "/index.html";
        stat = await tryStat(path);
      }
    }

    if (!stat?.isFile && url.pathname.endsWith("/")) {
      path = BUILD_PATH + url.pathname + "index.html";
      stat = await tryStat(path);
    }

    return serveFile(req, fromFileUrl(path), { fileInfo: stat });
  });
}
