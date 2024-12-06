import { posts } from "../pages/blog/utils.ts";
import { css } from "utils/css.ts";
import { href } from "utils/path.ts";

const classes = await css(import.meta.resolve("./BlogPreviewList.css"));
const allPosts = (await Array.fromAsync(posts()))
  .sort(({ meta: { date: a } }, { meta: { date: b } }) =>
    Temporal.PlainDate.compare(b, a)
  );

export function BlogPreviewList() {
  return (
    <li class={classes.list}>
      {allPosts.slice(0, 5).map((post) => (
        <div class={classes.post}>
          <a href={href(post.file)}>{post.meta.title}</a>
          <time datetime={post.meta.date.toString()} class={classes.meta}>
            {post.meta.date.toLocaleString("sv-SE")}
          </time>
        </div>
      ))}
      <a href="/blog">
        View all posts
      </a>
    </li>
  );
}
