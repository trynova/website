---
title: I worked for the Internet – now what?
description: Looking back on and past 6 months of work.
date: 2025-11-08
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Exactly [6 months](./working-for-the-internet) ago I wrote about Nova receiving
a grant from [NLnet](https://nlnet.nl/)'s NGI Zero Core fund and how I was one
month into a 6 month leave of absence. If you do the math and extrapolate the
logarithmic derivative of the fifth power of that function, you might arrive at
the conclusion that I am now one month into a return to my usual day job.

You'd be right: I am once more a TypeScript developer by day, a supervisor for
two student projects on Nova, a witless Rust language experiment author aimed at
making some of Nova's more painful parts less painful in the future, and an
occasional Rust developer on the remaining nights I manage to squeeze in between
all of that.

But what happened in Nova during that 6 months, and where are we going next?
Let's talk about it.

## Love is a flower...

Nova is, at its core, a passion project: it's the kind of JavaScript engine I
want to see exist, or at least attempted. I'm really grateful that NLnet gave me
the opportunity to work on it full-time and use that passion, but let's be real:
when I started this 6 month leave of absence Nova was not really at a place
where it could be considered for running anything more than test scripts.
Passion alone is not enough to create a JavaScript engine from scratch. The
foremost issue was a near-complete lack of garbage collection.

Technically, the garbage collector did exist and hasn't really even changed
significantly between that day and today, but the issue was that it could only
be run when no JavaScript was being run. This would have limited Nova to running
JavaScript programs that are so highly asynchronous that it would not be an
issue that garbage collection could only occur when waiting on a Promise to
resolve. 6 months ago, when I wrote the blog post, the lack of interleaved
garbage collection had just been solved but the engine still lacked a lot of
other features that we've come to expect of JavaScript.

Here's what the 6 months has resulted in inside of Nova, beyond the garbage
collector being properly usable:

- ECMAScript modules
- Finalisation of `for-of` loops and `for-await-of` loops
- `try-finally` blocks
- Labeled blocks
- Private properties
- `super` keyword
- RegExp (though not very compliant)
- String iterators
- WeakRef and WeakSet
- SharedArrayBuffers
- `JSON.stringify`
- BigInt binary and unary operators
- Global object methods
- TypedArray prototype methods

As it stands, according to our own tracking we're now at 77% Test262 compliance:
that is nothing to sneeze at, as it puts the engine in a place where I believe
it is quite useable indeed! If I were you, I would not bet my company on Nova
just yet, but if you want to try running a wholly different engine for your own
project then it should do pretty well. (And when you find issues please report
them to me, or even come over and fix them together with me!)

So, is the NLnet grant work over? No, not quite yet. Some work remains:

- Add and mostly replace existing heap allocation APIs with ones that can
  trigger garbage collection
- ECMAScript import attributes
- WeakMap and FinalizationRegistry classes
- Promise constructor methods (WIP)
- Atomics object methods (WIP)
- Optimisation of local variable access in the interpreter
- Processing issues from external security review
- Writing and publishing developer and user documentation
- Publicly launching Nova 1.0

But the list of remaining items is not that long, and I ... well, I don't
actually have any realistic ideas on how I'll be able to finish all of these
before the second week of December when my grant period runs out, but I'll be
trying my best. If you want to help, jump into our Discord and pick an item from
that list that doesn't have "WIP" on it.

## ... you're its seed

So, what's next then? Well, currently I'm once again a TypeScript developer by
day: it's not bad at all, it pays the bills in a much more stable and
stress-free way than a temporary grant with no advance (I was _this_ close to
not being able to pay my down payments in September!). At my day job I'm also
working on something fun and interesting, much the same kind of work I do in
Nova: this week I reduced memory usage of a particular cache data structure 10x,
taking it from being an 11 MiB collection of object graphs into being a 1 MiB
and change collection of graphs stored in a single ArrayBuffer and viewed using
2-10 TypedArrays. Next up will be more of the same but this time with a live
runtime data structure that sees infrequent changes: holding the invariants (or
breaking them in a principled manner) will be hard but the payoff will be even
sweeter as these live structures can grow to tens of megabytes in extreme test
cases.

Fun side note and soapbox moment here: some of the larger cached graphs are
measured in kilobytes when stored in the ArrayBuffer, and in these cases each of
the 10 TypedArrays viewing it have a meaningful part to play and are held as
private properties of a class instance, but in the simpler cases only 2
TypedArrays are needed with each viewing between 10 and 30 bytes each, and all
the other private properties store a `null` instead. If you've read some of my
earlier blog posts or watched
[a talk](https://github.com/aapoalas/losing-weight) I gave on this topic in
FOSDEM 2024, you might remember that TypedArrays in V8 are really big: even in
Chrome where heap references are only 4 bytes each, a single TypedArray or
ArrayBuffer is around 40-50 bytes in size, and a single class object with 10
inline private properties is 52 bytes. This means that in the 2-TypedArray case
a single cached graph takes roughly 150 bytes of JavaScript objects to hold 20
bytes of usable data. Even if I were to throw out everything but the
ArrayBuffer, it would still mean using around 50 bytes of an ArrayBuffer to hold
the 20 bytes. That's just sad, and that is why I want Nova to exist and become
successful.

So it should be clear that this is not the end of my work on Nova, and I'm not
about to run off into the hills. Yet, the time I dedicate to Nova directly is
currently at an all-time low: I am currently slammed with all sorts of things as
you might've picked up from the introduction, but it's all in service of the
Nova project.

Two student projects from the University of Bergen are currently finishing up
their work in and around the engine, one on expanding and improving our
[SoAVec](https://github.com/trynova/soavec/) crate for a wider audience to
enjoy, and one on starting the Temporal API implementation in Nova. I am of
course guiding them in their efforts, and I have promised to supervise new
student projects in the spring semester as well. It should be obvious that these
projects are a great boon and honour for Nova to receive, and for me personally
I absolutely love working with students and junior engineers. I'm one myself as
well, at least in my heart if not in the grey in my hair.

On the Rust language side, I have gone onto the dark side and started a language
experiment for supporting reborrowing of custom types in Rust itself: you can
find more on it in
[the Rust blog](https://blog.rust-lang.org/2025/10/28/project-goals-2025h2/#beyond-the)
as this work is part of the Rust project's flagship goals for this latter half
of the year! (This is also one of those "we do it not because it's easy, but
because we thought it'd be easy" things; I am so out of my depth here!)
Reborrowing forms a critical part of Nova's garbage collection safety story, and
it is also by far the most complicated and hard-to-grasp parts of the codebase.
Language-level support for reborrowing would make this a lot less ugly, and
might pave the way for further expansion that would eventually make Nova's
garbage collection truly fully checked by the borrow checker, instead of us
having to [abuse](https://github.com/aapoalas/abusing-reborrowing) it to force
checking.

Despite being busy, I'm not quitting working on Nova either, of course! I'm
currently working on implementing the Atomics object, and will possibly take two
(paid!) weeks off from work at the end of this month to try finish up the
remaining parts of the NLnet grant. Once the NLnet grant period finally runs
out, well... the world is not necessarily my oyster, but I do have cast some
lines already. First, I can apply for a new grant from NLnet for further work,
and I have some thoughts regarding that. Second, there are other grants out
there in the world that I can apply to and indeed I already have applied to a
few. The problem with grant money is of course the relative instability of it:
if I get a new 6 or perhaps 12 month grant, I'm not sure my company will allow
me to take another long leave of absence so soon after the first one. But for a
relatively short period like that, I couldn't really just quit either. So, if a
grant is to be in my future then it had better be a longer one, 2 years minimum
I'd think.

Beyond that, maybe a pot of gold will fall on my head: it's definitely possible,
I've seen pots of gold falling from the sky before (who knows where that pot has
been though... maybe it's a double-edge pot?). If you know any interested pots,
do throw them my way will you? Barring that, the reality is simply a return to
status quo ante stipendium: I will work on Nova to the best of my abilities with
the limited time I've been given, slowly improving on what exists today until
something changes.

A few interesting things that I see in Nova's future are:

- A focus on adding feature flags and taking advantage of them: this has
  potential use-cases at my day job as well. Best case scenario, I might be
  given leeway to work on Nova during work hours!
- A lot of performance work: the engine may work, but it is not really fast by
  any benchmark. That has to change if Nova is to become widely successful.
- Cooperation and embedding into [Servo](https://servo.org/): this is a lofty
  goal, but the basic idea at least is sound. Servo has signalled wanting to be
  modular on the engine front, and a JavaScript engine written in Servo's
  "native" Rust would probably fit them well. [Boa](https://boajs.dev/) is of
  course a much more natural fit for the job, but I'm not developing Boa so I
  won't be advocating for them over Nova.

Well, that's probably enough said about the future: it is in the future, after
all, and I am no fortune teller. If a pot falls, I'll let you know. I'll also
try to write up a blog post or two about more details from my grant work, as you
may find some of those things interesting. I'll leave you off with a final
shout-out: Dean Srebnik from the [Andromeda runtime](https://tryandromeda.dev/)
(which uses Nova as its JavaScript engine) will give
[a talk](https://jsconf.jp/2025/en/talks/andromeda-future-of-typescript) at
[JSConf JP](https://jsconf.jp/2025/en) next week. If you're in Tokyo, go listen,
and if not then wait for the video to come out I guess? Cheers!
