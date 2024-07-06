import { css } from "utils/css.ts";

const classes = await css(import.meta.resolve("./Talk.css"));

export interface TalkProps {
  title: string;
  description: string;
  speaker: {
    name: string;
    url?: string;
  };
  event?: {
    name: string;
    url?: string;
  };
  date?: string;
  slides?: {
    name: string;
    url: string;
  }[];
  youtubeId: string;
}

function Name({ name, url }: { name: string; url?: string }) {
  if (url) {
    return <a href={url}>{name}</a>;
  }

  return <>{name}</>;
}

export function Talk({
  title,
  description,
  speaker,
  youtubeId,
  slides,
  event,
  date,
}: TalkProps) {
  return (
    <article class={classes.talk}>
      <iframe
        class={classes.video}
        src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
        title="YouTube video player"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
      <section class={classes.info}>
        <h2 class={classes.title}>{title}</h2>
        <section class={classes.metadata}>
          <address>
            <Name {...speaker} />
          </address>
          {event && (
            <>
              @ <Name {...event} />
            </>
          )}
          {date && (
            <>
              @ <time datetime={date}>{date}</time>
            </>
          )}
        </section>
        {slides && (
          <ul class={classes.slides}>
            {slides.map((slide) => (
              <li>
                <Name {...slide} />
              </li>
            ))}
          </ul>
        )}
        <p class={classes.description}>{description}</p>
      </section>
    </article>
  );
}
