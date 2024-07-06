import { BUILD_PATH, PAGES_PATH } from "utils/consts.ts";

/**
 * Takes a page path and returns it as the output path of said page.
 */
export function output(path: string): string {
  return path
    .replace(PAGES_PATH, BUILD_PATH)
    .replace(/\.\w+$/, ".html");
}
