---
title: FOSDEM 2025
description: Reviewing two talks on or around Nova JavaScript engine.
date: 2025-02-16
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

At the turn of this month, I went to [FOSDEM](https://fosdem.org/2025/) for the
first time in my life. I was drawn in by the chance to meet fellow open source
enthusiast and by stories I'd heard. I also wanted to give a talk or two around
data-oriented design and Nova. In the end I gave one talk on how we use Rust's
borrow checker to ensure garbage collected value invalidate at garbage collector
safepoints, and one talk on memory optimizations in JavaScript based on
data-oriented design. Here are my thoughts on the talks, and FOSDEM in general.
I will also use this platform to answer questions I received in more detail.

## [Abusing reborrowing - On Nova's garbage collector safepoints](https://fosdem.org/2025/schedule/event/fosdem-2025-4391-how-to-lose-weight-optimising-memory-usage-in-javascript-and-beyond/)

Nova's garbage collector is still not an interleaved one, ie. currently garbage
collection can only happen when JavaScript is not being executed. I am actively
working on getting us to an interleaved garbage collector and the most important
thing in this work has been explaining when the garbage collector invalidates
JavaScript Values (and other engine-internal garbage collected heap values that
are not accessible to JavaScript code directly). The way this is done in the
engine is through borrow checker trickery related to "reborrowing" of zero-sized
types that represent access to the garbage collector.

The talk was effectively a walk-through of the process that lead me to
"discover" this trickery: The truth is that I very much copied the idea from
[PeripheralRef](https://docs.rs/esp32h2-hal/latest/esp32h2_hal/peripheral/struct.PeripheralRef.html)
which was suggested to me on the
[Rust Programming Language Community Discord](https://discord.gg/rust-lang-community)
by Gnelf, so thank you for that <3. The
[reborrow crate](https://docs.rs/reborrow/latest/reborrow/) would have also
provided all the things I needed without me having to reimplement a lot of it.

In general, I would say that the talk went quite well: I managed to stay within
the time limit and actually finished early. Unfortunately, I likely also skipped
some things that would have been useful for the listeners' understanding.
Another unfortunate thing was that my talk coincided with the Rust for Linux
project keynote speech, meaning that as the previous talk
([Orhun Parmaksız](https://fosdem.org/2025/schedule/event/fosdem-2025-5496-bringing-terminal-aesthetics-to-the-web-with-rust-and-vice-versa-/)'s
excellent talk on [Ratatui](https://ratatui.rs/)) finished and my talk was
slated to start, at least a third of the audience left the hall.

I had practiced the talk multiple times on my own and once with a live audience
of Rust programmers online. One thing that came up during the practice with a
live audience was that it wasn't clear that I am building a garbage collector;
ie. it wasn't clear to the listeners that I am not trying to write a bump
allocator but trying to explain how a garbage collector works to the borrow
checker. As a result of that realisation, I removed all direct mentions of
adding data into the garbage collector heap and instead only used a `get` method
to get value references from the heap.

Looking at it now I would probably rename the `get` method into something that
implies it is a stand-in method that performs some work and returns a result
from the heap, which would then better explain why it requires exclusive access
to the heap. I also didn't explain very well what the "references into the heap"
are during the talk: In Nova's case they are indexes into vectors, but that is
not exactly how I would explain it today. The way I would explain it would be
that our "references" are opaque data that the heap can interpret to find the
actual "referenced" data within the heap. In borrow checker -philosophical terms
we could say that the heap has exclusive ownership of the heap data but the
garbage collected nature of the heap means that the validity of a "reference" is
separated from the validity of the memory it points to. This effectively
requires having multiple lifetimes to explain the garbage collected heap to
Rust's borrow checker effectively.

### Question: "Why?" and "Why in Rust?"

Garbage collectors are valuable tools for memory safety: Scripting languages
built ontop of garbage collectors are massively popular and, arguably, mildly
useful. Garbage collectors are usually written in C or C++ and rely on either
double-indirection and/or conservative garbage collectors. The reason for this
is, from my understand, that those are the only reasonable choices.

A garbage collector written in Rust can take advantage of the borrow checker to
open up new possibilities: If we can use the borrow checker to statically check
the validity of our "references" then we can create an exact garbage collector
without double-indirection. I may well be wrong, but I'm hoping that this will
turn out to be more performant than we'd traditionally expect from exact garbage
collectors.

### Question: Doesn't the `(un)bind()` song and dance undermine the benefits of the borrow checker?

The reference validation in the engine is not automatic: It requires manually
binding all of your garbage collectable parameters at the beginning of your
function. This is mildly error-prone, and each error means that the engine may
eventually produce a bug that will be quite complicated to track down. Does this
not undermine the benefits we get from the borrow checker?

Yes, it does and I would like to avoid the manual parts. Macros could help, new
Rust features could help. Still, at the end of the day this song and dance is a
necessary evil and also the thing that enables the borrow checker to work here
at all in the first place.

## [How to lose weight?](https://fosdem.org/2025/schedule/event/fosdem-2025-4391-how-to-lose-weight-optimising-memory-usage-in-javascript-and-beyond/)

This talk was inspired by a piece of data-oriented design refactoring that I did
in my day job where I brought a particular client side in-memory database's
memory usage down to around 9 MiB from more than 80 MiB. Unfortunately, I could
not fit the real code example into my talk and instead had to make do with a
simplified example of the tricks involved in this refactoring.

I originally gave a version of this talk at my company where the focus was more
on the theoretical parts of the work and how the ideas work in lower-level
compiled languages such as Rust and C++. Using the same tricks in JavaScript was
only briefly mentioned but my thinking was that it wouldn't take a lot of effort
to "reconfigure" the talk to focus on JavaScript. It turns out I was very wrong
about this and I spent the better part of January rewriting the talk over and
over again, until the theoretical parts were entirely removed and the final form
of the talk emerged from the wreckage.

Even then, the talk was sorely lacking in detail and real code at least to my
liking. The possibilities of data-oriented design in optimising JavaScript
memory usage (both on the engine level, like in Nova, and on the user code
level) are real and powerful, but they're not entirely simple things and a
cursory look will likely only make the listener confused rather than excited for
the most part. I have a feeling I will have to revisit this talk in the future,
in one form or another.

### Question: "Why not use AssemblyScript compiled into Wasm that does all this for you?"

AssemblyScript or Wasm in general gives you better memory usage compared to
JavaScript, and there are many places where it probably makes sense to use it.
However, when you are looking to optimise the memory usage of data structures
then AssemblyScript is not an automatic tool for the job, not yet anyway.
Booleans are still terrible use of memory even in C, C++, Rust, and
AssemblyScript. The best-case scenario for a singular boolean type is 1 bit of
information used but 8 bits of memory required. Alignment means that the
worst-case scenario can be equally horrible as it is in JavaScript, 1 bit of
information but 64 bits of memory used. Alignment also means that your
classes/structs may hold padding, which takes up memory but holds 0 bits of
information. As mentioned, the original version of this talk focused more on
lower-level compiled languages like C++ and Rust (it even made some of my
coworkers turn to me for ideas and review on memory optimisations in their C++
code): Losing weight is not something that only JavaScript can or needs to do,
the same ideas are equally available and applicable in C, C++, Rust, and
AssemblyScript.

When memory optimisations of this kind are what you want, Struct-of-Arrays gives
various opportunities such as allowing removal of all alignment, while
data-oriented design can help you to further reduce memory usage by for example
getting rid of any remaining booleans, or reducing your pointers to small
indexes. AssemblyScript will not write the Struct-of-Arrays parts of your code
automatically; the only languages that I know of that do offer such automatic
transformations are Zig (see
[MultiArrayList](https://ziglang.org/documentation/0.8.0/std/#std;MultiArrayList))
and Jai (closed source, documentation not available at least publicly).
AssemblyScript also cannot use the context knowledge you hold to make optimal
data structure choices for you. Even if you were to tell the compiler that a
particular 4 byte integer is usually between 0 and 1920, the compiler could not
use that information to choose to store the integer in 2 bytes with a sentinel
value used to indicate that the full value is found in a hashmap on the side.
You must make those choices.

Besides that, there are also downsides to working in the Wasm and JavaScript
interface: Strings are painful (though if you internalise strings into integers,
this issue is mitigated), keeping references to JavaScript objects is painful
(and likely has non-zero memory impact), and at the end of the day if what
you're looking for is less memory usage instead of raw processing performance
then you're not really even using Wasm's best feature. At that point, does it
make sense to use it at all?

There absolutely are times when AssemblyScript will be the right choice and you
should take it when you need it, but don't forget to bring your context
knowledge and data-oriented tricks when you go there: They will be of use
wherever you go.

## FOSDEM 2025 in retrospect

I _think_ I had fun at FOSDEM. But I also feel like I missed most. I sat in the
Rust devroom for maybe too long, anxiously awaiting and looking forward to my
own talk, and once it was done I ended up going to lunch with friends just when
a few interesting talks were starting. I spent a good while ambling around with
friends and meeting interesting people, but didn't really get into deep
technical discussions. The few live meetups, those that are not streamed or
recorded and thus cannot be revisited after the fact, that would've probably
been really beneficial for me to visit I completely missed in the schedule and
was only told about them after the fact when a friend noticed that them and
thought I would've found them interesting.

By far the best thing out of FOSDEM was that I got to sit down with
[Andreu Botella](https://github.com/andreubotella), one of Nova's main
co-conspirators, the person who inadvertently set the project in motion, and the
author of our async-await execution code. We sat down for more than 2 hours, I
believe, and they helped me figure out the parts that I was doing wrong in our
async generators implementation. At the end of that day, thanks to Andreu's
help, I merged [the PR](https://github.com/trynova/nova/pull/520) to fully
implement async generators!

So FOSDEM was, all in all, a bit overwhelming. So much possibilities, so little
time, so many missed opportunities, and yet so much achieved. It definitely was
not a wasted weekend, but it also did not change my world. I am thinking that I
should revisit my FOSDEM talks as a series of video essays or live streams, so
as to flesh out the parts that I could've said better or explained in more
depth. Maybe that will bring me the perfect closure to that weekend.

Until next year, maybe?
