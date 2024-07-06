import { css } from "utils/css.ts";

import { Logo } from "components/icons/Logo.tsx";

const classes = await css(import.meta.resolve("./Header.css"));

export function Header() {
  return (
    <header class={classes.header}>
      <a class={classes.logo} href="/">
        <Logo />
        <h1>Nova</h1>
      </a>
      <nav>
        <a href="/talks">Talks</a>
        <a href="/blog">Blog</a>
        <a href="/docs">Docs</a>
        <a href="/contribute">Contribute</a>

        <script
          dangerouslySetInnerHTML={{
            __html: `
          const page = new URL(document.URL).toString();
          document.querySelectorAll("a").forEach((a) => {
            const href = a.getAttribute("href");
            if (href === null) return;
            const url = new URL(href, document.URL).toString();
            if (url === page || url + "/" === page) {
              a.classList.add("active");
            }
          });
        `,
          }}
        />
      </nav>
    </header>
  );
}
