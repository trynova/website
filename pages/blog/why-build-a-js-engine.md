---
title: Why build a JavaScript engine?
description: Addressing the most important elephant in the room.
date: 2024-07-12
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

So, you want to ask the obvious question: Why would someone choose to build a
new JavaScript engine? Don't we already have the perfect engine in [INSERT
ENGINE NAME HERE]?

Let me answer that question!

## But first! History!

The very first JavaScript engine to be built was none other than SpiderMonkey:
Yes, the engine that is still running in Firefox. Other engines followed, many
of them have already passed into forgotten history but the big ones that
remained were V8, SpiderMonkey, JavaScriptCore, and Chakra.

The JavaScript world was then a peaceful place where all these lived happily
together, and all were equal. That is, as long as you don't think about the
different API support, the competition, and underhanded tactics and all that.
But at least on the server side things were peaceful: There was only Node.js.
That is, until Ryan Dahl
[nailed his ten theses on the door](https://www.youtube.com/watch?v=M3BM9TB-8yA)
of the JSConf EU backstage in 2018, and Deno was born.

Deno was still fairly simple: It still runs the same V8 JavaScript engine under
the hood. But then Bun came along, and it uses JavaScriptCore (of Safari fame)
so then there were two. But even before that, actually, we had various flavours
of Node.js that replaced the V8 engine with Microsoft's Chakra engine or with
Mozilla's SpiderMonkey engine. Oh and actually, the server-side focused QuickJS
engine has existed long enough to be abandoned and forgotten, get forked, and
restart development again.

And now that we're dredging up various names, we should mention LibJS which
powers the Ladybird browser. It is probably the newest (arguable) success story
of JS engines, having equivalent or higher
[test262](https://test262.fyi/#|v8,sm,jsc,libjs) passing figures as Google's V8
and the other major engines. It is, in essence, a fully complete JavaScript
engine built in only the last few years. It has also acted as the flagship for
specification-oriented JavaScript engine design, though it was probably not the
first one to envision of this idea.

Many other engines exist beside these as well: [Boa](https://boajs.dev/),
[Kiesel](https://kiesel.dev/), [GraalJS](https://github.com/oracle/graaljs),
[engine262](https://engine262.js.org/), and then some more experimental ones
like [Hermes](https://github.com/facebook/hermes) and
[Porffor](https://porffor.dev/). So, if we have such a great variety of engines,
why build yet another?

## The Bad

The first obvious answer is: There really is no good reason to build yet another
engine. One's time would be much better spent by eg. contributing to QuickJS,
LibJS, or perhaps Kiesel, or even one of the major engines like V8 and
SpiderMonkey. And if you don't like the traditional engine designs, then perhaps
Porffor or Hermes will be more to your liking?

The second obvious answer and counterpoint to the first is: You don't need a
reason to do something you want to do. Do what you want to do, and see where
that takes you.

## The Ugly

There are some things that are really, really ugly about JavaScript and
JavaScript engines. The ugly parts of JavaScript as a language are something
that major engines cannot ignore, they need to live with them. And most engines
have to accept the fact that separating the ugly parts from the good parts is
not really feasible due to the way Object inheritance at the language
specification level works.

What do we mean by ugly? We mean things like `array.shift()` having to possibly
check through the whole prototype chain for indexed property getters and
setters, or even that indexed property getters and setters are a thing in the
first place. We mean things like named properties (except `"length"`) on arrays
being a thing that most take as obvious and acceptable or even good. Or named
properties on `DataView`s and `TypedArray`s.

Now, we cannot go back in time and change how JavaScript is designed. Nor can we
go back in time and change how engines are built. We could go and try to
refactor Object inheritance in eg. V8, or Kiesel, or LibJS. But it's most likely
that this would never be accepted. The change is too big, and the payoff too
uncertain.

So, if we want to try something new, a new spin on the ECMAScript specification,
then we have to build it ourselves.

## The Good

Luckily, we do have an idea, a new spin on the ECMAScript specification. The
starting point is data-oriented design or essentially the observation that a
computer loads memory by the cache line (usually 64 or 128 bytes), not by
individual bytes, and that loading memory is slow. It is so slow in fact that
compared to memory reads doing computation on the CPU is effectively free.

So, when you read a cache line you should aim for the entire cache line to be
used. The best data structure in the world, bar none, is the humble vector (or
array by another name). A data structure that carries within it multiple
logically related but algorithmically unrelated pieces of data is a terrible
data structure: Loading some of the data in the structure loads all of the data
in the structure but likely loads none of the data that you're about to use in
combination with your structure's data to do new calculations.

So what we want to explore is then: What sort of an engine do you get when
almost everything is a vector or an index into a vector, and data structures are
optimised for cache line usage? Join us in finding out: The change in thinking
and architecture compared to a traditional engine is large, which means that the
payoff can be huge! Maybe one day Nova will be the engine that everyone uses.
But equally, the downsides can be huge to the point where the entire experiment
is found to be a failure.

Only time and work will tell. If you want to get involved, head over into
[our GitHub repo](https://github.com/trynova/nova), jump on
[our Discord](https://discord.gg/RTrgJzXKUM), or get in touch otherwise and
start hacking away. We're looking forward to meeting you!
