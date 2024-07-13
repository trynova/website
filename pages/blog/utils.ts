import { extractYaml } from "@std/front-matter";
import { dirname } from "@std/path";

import { read, walk } from "utils/fs.ts";

interface BlogPostAttrs {
  title: string;
  description: string;
  date: string | Date;
  authors: { name: string; url: string }[];
}

export interface BlogPostMeta {
  title: string;
  description: string;
  date: Temporal.PlainDate;
  authors: { name: string; url: string }[];
}

export interface BlogPostProps {
  file: string;
  body: string;
  meta: BlogPostMeta;
}

export async function* posts(): AsyncGenerator<BlogPostProps> {
  for await (const file of walk(dirname(import.meta.url) + "/~")) {
    if (file.endsWith(".md")) {
      const text = await read(file);
      const { attrs, body } = extractYaml<BlogPostAttrs>(text);

      let date: Temporal.PlainDate;
      if (attrs.date instanceof Date) {
        date = attrs.date
          .toTemporalInstant()
          .toZonedDateTimeISO("UTC")
          .toPlainDate();
      } else {
        date = Temporal.PlainDate.from(attrs.date);
      }

      yield {
        file,
        body,
        meta: {
          title: attrs.title,
          description: attrs.description,
          date,
          authors: attrs.authors,
        },
      };
    }
  }
}
