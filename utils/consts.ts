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
 * The base path for the website.
 */
export const BASE_PATH = Deno.env.get("BASE_PATH") ?? "";

/**
 * The url of the website.
 */
export const LOCATION = Deno.env.get("LOCATION") ?? "https://trynova.dev";
