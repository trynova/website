import { BASE_PATH, BUILD_PATH, LOCATION, PAGES_PATH } from "utils/consts.ts";

/**
 * Takes a page path and returns it as the output path of said page.
 */
export function output(
  path: string,
  extension: `.${string}` = ".html",
): string {
  return path
    .replace(PAGES_PATH, BUILD_PATH)
    .replace(/\.(tsx|md)$/, extension);
}

/**
 * Takes a page path and returns it as the href path of said page.
 */
export function href(path: string): string {
  return BASE_PATH + path
    .replace(PAGES_PATH, "")
    .replace(/\.\w+$/, "");
}

/**
 * Takes a page path and returns it as an absolute http(s) URL.
 */
export function absoluteHref(path: string): string {
  return LOCATION + path
    .replace(PAGES_PATH, "")
    .replace(/\.\w+$/, "");
}
