---
title: 2024 - Looking backwards and fowards
description: On foward and lateral progress.
date: 2024-12-30
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

The end of the year is upon us, and this is as good a point as any to take a
look back at what we've achieved in a year's time. Looking back is of course
meaningless without a future, which is where we're heading next.

## Nova during 2024

When this year began, Nova was very much barely taking its first steps. One of
the last commits of 2023 (the first year during which active development
happened) added "working basic bytecode". The engine couldn't be tested beyond
unit tests, and basically all we had to show was a solid idea of where we're
going and a bunch of abstract operation implementations.

In January I gave a talk on Nova at a local Rust meetup, mostly showcasing the
idea as there wasn't much more to show. I did get a hearty chuckle out of the
audience when I confessed that calling functions was, as yet, not possible.
Still, I felt that the talk was useful in making me more invested and believe in
the project. This wasn't just a dumb idea that has been proven wrong time and
again: If I explain the concepts, people will nod and say: "That sounds
potentially interesting."

The first half of the year was spent mostly adding support for a lot of the
basic things (like those function calls that were missing in January, or object
creation, constructor calls, ...) and drawing in the rest of the big picture:
The way object internal methods are implemented was fleshed out and finally got
into a pretty good shape with boring sort of objects like Map and Set not
needing any custom internal method implementations on them. A basic
mark-and-sweep garbage collector algorithm was implemented. The project started
to resemble a real engine that could run some basic JavaScript scripts.

In June, I gave another talk on Nova at Web Engines Hackfest. The talk and
Hackfest in general was a great experience: I got to meet with many people much
more experienced in JavaScript engines than myself, and made a lot of contacts
that I hope to one day have the priviledge of calling friends. The talk was also
well-enough received that I was invited to give it anew at the TC39 meeting in
Helsinki later that month. That lead to meeting again more engine developers
with whom I've exchanged quite a bit of words since.

The latter half of the year has been somewhat less flashy: Nova made it to
Hacker News' front page through the second-chance pool (thank you to HN Daniel
for that <3) which did generate a good bit of publicity, comments on HN, and new
contributors which is great! But aside from that we've just been working on
getting the engine closer and closer to a state where I would be happy to call
it "version 1".

## Forward and lateral progress

If you took a look at our Test262 tracking, it would seem like we've pretty much
stagnated on that front. The pass rate hasn't moved much over the last commits
and the last commit to have moved the pass rate is from 3 weeks ago. It's not
unfair to say that this is indeed what stagnation looks like.

However, we've not been standing still. Much, or all, of the recent work has
been on making the engine compatible with running the garbage collector
interleaved with JavaScript execution: That is, instead of having to rely on
JavaScript execution to perform an `await` or stop until a `setTimeout` resolves
and performing garbage collection during these pauses, enable the engine to
perform garbage collection in between running bytecode commands. This hasn't
been a terribly easy, or even the most enjoyable, thing to do.

An interleaved garbage collector is essential for a JavaScript engine, but
JavaScript is also a pretty painful language from a garbage collector point of
view: If garbage collection can happen interleaved with JavaScript execution,
then that effectively means that any place in the standard that might call into
JavaScript is liable to cause a garbage collector pause. In Nova I've (so far
anyway) made the choice to be optimistic about garbage collector pauses: As long
as we're not sure we're calling into JavaScript we assume we won't, and we don't
root any JavaScript Values on the stack. Only if we find that a JavaScript call
is about to happen, do we root our Values and then perform the call.

Doing this without falling down in tears requires a lot of help from the
compiler. Luckily Rust's lifetimes are just what we need for this. The problem
just is that we haven't had Rust lifetimes on our JavaScript Values for a year
(and even back then they were meaningless or wrong). So what I've been doing the
last few months is slowly, ever so slowly reintroducing lifetimes into the
engine to take advantage of the Rust compiler's static guarantees. It has been
slow going and painful, and I'm not entirely satisfied with all the choices I've
ended up with throughout this work, but the end result will be an engine that is
statically guaranteed to be interleaved garbage collector -safe while avoiding
rooting of Values on the happy paths.

I'm hoping to be done with this work in at most a few months time (I know that's
not very quick, but the amount of work is quite large as well), at which point
the engine should be capable of running JavaScript benchmarks (currently any
sufficiently large benchmark will run out of memory, or is at least silly slow
as memory is never reused). At that point I can get back to making the Test262
line go up and also start doing some minor performance work to validate the
data-oriented heap design of the engine.

## Future days

The coming year will hopefully smile upon Nova: In February I will be giving two
talks at [FOSDEM](https://fosdem.org/2025/), one of them on the aforementioned
interleaved garbage collector work from Rust's point of view, and another on
memory optimisations in JavaScript based on data-oriented design points that
we've already used for great effect in Nova (see eg.
[Data-oriented view](./data-oriented-view)). You can be sure that I'll be
mentioning Nova in both talks!

I'm also hoping to devote a bit more of my time to the project, free- or
otherwise. There's still so much to do, but there's no other way to do it than
to chip at it one line of code at a time.
