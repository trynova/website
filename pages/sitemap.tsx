import { write } from "utils/fs.ts";
import { absoluteHref, output } from "utils/path.ts";
import { posts } from "./blog/utils.ts";

const allPosts = await Array.fromAsync(posts());

if (import.meta.main) {
  await write(
    output(import.meta.url, ".xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${absoluteHref("")}</loc></url>
  <url><loc>${absoluteHref("/talks")}</loc></url>
  <url><loc>${absoluteHref("/test262")}</loc></url>
  <url><loc>${absoluteHref("/contributing")}</loc></url>
  <url><loc>${absoluteHref("/blog/")}</loc></url>
${
      allPosts.map((post) => (`\
  <url>
    <loc>${absoluteHref(post.file)}</loc>
    <lastmod>${post.meta.date.toString()}</lastmod>
  </url>`)).join("\n")
    }
</urlset>`,
  );
}
