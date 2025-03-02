import { renderToString } from "preact-render-to-string";

import { html } from "utils/html.ts";
import { output } from "utils/path.ts";
import { write } from "utils/fs.ts";

import { Layout } from "components/Layout.tsx";
import { Talk } from "components/Talk.tsx";

function Talks() {
  return (
    <Layout>
      <h1>Talks</h1>
      <Talk
        title="Abusing reborrowing for fun, profit, and a safepoint garbage collector"
        description={"Focuses on the technical challenges and solutions that lead to Nova's safepoint garbage collector design. The final design mildly abuses Rust's \"reborrowing\" functionality to make the borrow checker not only understand Nova's garbage collector but cooperate with making sure it is used in the correct way."}
        speaker={{
          name: "Aapo Alasuutari",
          url: "https://github.com/aapoalas",
        }}
        event={{
          name: "FOSDEM 2025",
          url: "https://fosdem.org/2025/",
        }}
        slides={[
          {
            name: "Slides",
            url:
              "https://fosdem.org/2025/events/attachments/fosdem-2025-4394-abusing-reborrowing-for-fun-profit-and-a-safepoint-garbage-collector/slides/237982/Abusing_r_4Y4h70i.pdf",
          },
        ]}
        videoUrl="https://video.fosdem.org/2025/ub2252a/fosdem-2025-4394-abusing-reborrowing-for-fun-profit-and-a-safepoint-garbage-collector.av1.webm"
        date={Temporal.PlainDate.from("2025-02-15")}
      />
      <Talk
        title="Nova Engine - Building a DOD JS Engine in Rust"
        description="Focuses on how JavaScript engines work in general, and what sort of design choices Nova makes in this context."
        speaker={{
          name: "Aapo Alasuutari",
          url: "https://github.com/aapoalas",
        }}
        event={{
          name: "Finland Rust-lang group meetup",
        }}
        slides={[
          {
            name: "Slides",
            url:
              "https://docs.google.com/presentation/d/1PRinuW2Zbw9c-FGArON3YHiCUP22qIeTpYvDRNbP5vc/edit?usp=sharing",
          },
        ]}
        youtubeId="WKGo1k47eYQ"
        date={Temporal.PlainDate.from("2024-01-13")}
      />
      <Talk
        title="Nova JavaScript Engine - Exploring a Data-Oriented Engine Design"
        description="Focuses on the details of why a data-oriented engine design is interesting, what sort of benefits it gives and what sort of costs it has. Explores the engine at a slightly deeper level.

          The talk was revisited at the TC39 June meeting, 2024. No video is available, but the slightly modified slides are."
        speaker={{
          name: "Aapo Alasuutari",
          url: "https://github.com/aapoalas",
        }}
        event={{
          name: "Web Engines Hackfest 2024",
          url: "https://webengineshackfest.org/2024/",
        }}
        slides={[
          {
            name: "Slides",
            url:
              "https://docs.google.com/presentation/d/1YlHr67ZYCyMp_6uMMvCWOJNOUhleUtxOPlC0Gz8Bg7o/edit?usp=sharing",
          },
          {
            name: "TC39 slides",
            url:
              "https://docs.google.com/presentation/d/1Pv6Yn2sUWFIvlLwX9ViCjuyflsVdpEPQBbVlLJnFubM/edit?usp=sharing",
          },
        ]}
        youtubeId="5olgPdqKZ84"
        date={Temporal.PlainDate.from("2024-06-03")}
      />
    </Layout>
  );
}

if (import.meta.main) {
  await write(
    output(import.meta.url),
    html(renderToString(<Talks />), {
      title: "Talks · Nova",
      description: "Talks about the Nova JavaScript engine",
      canonical: "/talks",
    }),
  );
}
