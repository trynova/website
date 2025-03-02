import { css } from "utils/css.ts";
import { NameLink } from "components/NameLink.tsx";

const classes = await css(import.meta.resolve("./Talk.css"));

export type TalkProps = VideoTalkProps | YoutubeTalkProps;

export interface VideoTalkProps extends BaseTalkProps {
  videoUrl: string;
}

export interface YoutubeTalkProps extends BaseTalkProps {
  youtubeId: string;
}

export interface BaseTalkProps {
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
  date?: Temporal.PlainDate;
  slides?: {
    name: string;
    url: string;
  }[];
}

export function Talk({
  title,
  description,
  speaker,
  slides,
  event,
  date,
  ...props
}: TalkProps) {
  return (
    <article class={classes.talk}>
      {"youtubeId" in props
        ? (
          <iframe
            class={classes.video}
            src={`https://www.youtube-nocookie.com/embed/${props.youtubeId}`}
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowFullScreen
            loading="lazy"
          />
        )
        : (
          <video
            class={classes.video}
            src={props.videoUrl}
            controls
            preload="metadata"
            loading="lazy"
          />
        )}
      <section class={classes.info}>
        <h2 class={classes.title}>{title}</h2>
        <section class={classes.meta}>
          By{" "}
          <address>
            <NameLink {...speaker} />
          </address>
          {event && (
            <>
              {" "}at <NameLink {...event} />
            </>
          )}
          {date && (
            <>
              {" "}at{" "}
              <time datetime={date.toString()}>
                {date.toLocaleString("sv-SE")}
              </time>
            </>
          )}
        </section>
        {slides && (
          <ul class={classes.slides}>
            {slides.map((slide) => (
              <li>
                <NameLink {...slide} />
              </li>
            ))}
          </ul>
        )}
        <p class={classes.description}>{description}</p>
      </section>
    </article>
  );
}
