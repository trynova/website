/**
 * The path to the pages directory.
 */
export const PAGES_PATH = import.meta.resolve("../pages");

/**
 * The path to the public directory.
 */
export const PUBLIC_PATH = import.meta.resolve("../public");

/**
 * The path to the build directory.
 */
export const BUILD_PATH = import.meta.resolve("../build");

/**
 * The base URL for the website.
 */
export const BASE_URL = Deno.env.get("BASE_URL") ?? "";
