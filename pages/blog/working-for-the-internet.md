---
title: Working for the Internet
description: Nova JavaScript engine is now supported by an NLnet grant!
date: 2025-05-08
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

In March, I received news that [NLnet](https://nlnet.nl/) had chosen Nova
JavaScript engine as one of the projects receiving a grant in the October 2024
call of the NGI Zero Core fund. You can read their announcement of the October
call results
[here](https://nlnet.nl/news/2025/20250321-call-announcement-core.html). I
recommend taking a look, as there are many interesting projects receiving grants
beyond just Nova!

In short this means that I am now one month into a 6 month leave of absence from
my day job, and am thus no longer a TypeScript developer by day and a Rust
developer by night. I am now fully focusing on Nova. But what is the project all
about, and what else am I doing with my time? How does this affect me
personally? Let's find out.

## Project goals

I applied for the NLnet grant for taking Nova to 70% or more Test262 compliance,
and proving the data-oriented heap design's feasibility and its memory and
performance benefits. During the application process a more detailed plan was
written up and decided upon in a "Memorandum of Understanding". The highlights
are as follows.

### Interleaved garbage collection

The most urgent thing that I wanted to achieve was enabling interleaved garbage
collection in Nova. Not being able to perform garbage collection while
JavaScript is running is a fatal problem for a general purpose JavaScript
engine. It means that for example long-running synchronous code will keep using
more and more memory without ever cleaning up any unused objects.

I had estimated that getting the engine working with interleaved garbage
collection would take about a month of work, and I am extremely pleased and
surprised to find that I was my estimate was quite accurate: aside from one
optional change to the way that the engine triggers garbage collection, this
work is finished and interleaved garbage collection is turned on and running
today!

This means that you can now take Nova out on a spin with your favourite
JavaScript benchmarks and they will (probably) run and give you actual results!
Of course, there are still unimplemented parts that will throw an error or
crash, but most normal JavaScript code should not give you any problems. If
you're interested in doing performance optimisations on a JavaScript engine,
this is a great chance to get involved and start learning by doing! But more on
performance later.

### ECMAScript modules

I am a big fan of ECMAScript modules, and strict mode JavaScript in general. As
such it is actually a bit of a surprise that modules have not been implemented
yet in Nova; some [attempts](https://github.com/trynova/nova/pull/178) have been
made but they've not quite made it all the way through. One reason is that the
modules specification is fairly wide, and my attempt of implementing the
specification in a single go lead to a PR that is too complex to really get back
into.

With NLnet's support it is time to do the work good and proper. I quite look
forward to taking on this fight again, this time with a more methodical
approach. Before I start on this I'm thinking of finishing some of the larger
remaining syntax features of JavaScript, though.

### Filling in missing features

Nova is very nearly at 60% pass-rate on Test262, although the bar keeps rising
up as more tests and extensions are added. Still, 60% does not mean that we're
done with the "old" features either. Some features that got into the grant plan
were relatively simple things: labelled statements, the super keyword, and
String iterators come to mind. Of these, labelled statements and String
iterators have already been handled as light snacks to go with the heavier
engine work.

Other things still remaining on the list are much more involved:
SharedArrayBuffers are technically fairly simple since we have ArrayBuffers
working already, but they may cut surprisingly deep to how our TypedArrays and
ArrayBuffers work today. Weak references, for WeakRef and WeakSet, are fairly
straightforward and thus got handled already (just last night!) but ephemerons
needed for WeakMap are [decidedly not](https://wingolog.org/tags/ephemerons).
Implementing RegExp will require quite a bit of work indeed (and making it
performant is a whole other can of worms), and we still have a good amount of
missing builtin methods to implement that might individually be fairly easy but
put together make for a much gnarlier whole.

A large missing pair of syntax features is destructuring in for-in/of loops, and
for-await loops. Destructuring is likely mostly going to require wiring up a
couple of loose threads, but for-await loops are another thing altogether. There
is likely at least some need to expand the bytecode interpreter's instruction
set, for instance. To speak honestly for a moment: implementation of
asynchronous JavaScript features is a painful as the specification is complex
and written in a style that mostly hides discontinuity spots. It makes sense to
write the specification this way as it is the way we think about JavaScript code
execution, but from an implementation point of view it is painful because it
requires splitting up the abstract operations into synchronous parts, and
knitting those parts into different complete wholes during the implementation
work.

That being said, a lot of this is exactly the kind of work that I most enjoy
about working on Nova, so I'm definitely not complaining (over much anyway). It
is of course quite intimidating to see the mountain of work, but that's par for
the course.

### Performance and maintenance

You might have read in previous blog posts about how Nova saves or intends to
save memory when compared to a more traditional engine design. Those memory
savings are one of the things that I expect to give Nova an edge in performance,
but they alone are not enough. For one, we currently use perfectly ordinary Rust
vectors for storing heap allocated data, and specifically we use array-of-struct
layouts. This is done only because it is convenient. What I want us to use is
struct-of-arrays vectors with a maximum capacity of 2^32 items. The library to
provide this for us does not exist today, so we need to create our own. Luckily
[the oxc project](https://github.com/oxc-project/), which we use as our parser,
also wants the same thing, so I'll be cooperating with them to make this library
a reality.

But a struct-of-arrays vector isn't really going to be a step change in Nova's
performance; in an absolutely optimal case I expect it might net us at most an
80% performance improvement, and in most cases the improvement will be 30% or
less. No, the thing that makes or breaks a JavaScript engine's performance is
inline caches and, in general, redundant load elimination. Take a look at the
following loop:

```js
const a = {};
for (let i = 0; i < 10000; i++) {
  a[i] = i;
}
```

Right now, when Nova runs this loop, it will re-read the variables `i` and `a`
from hash maps every time they are mentioned in the code. This means performing
50,000[^1] hashing operations and hash map lookups for the same strings over and
over again. This is of course not a great thing. In this case, we could perhaps
see that `a` can never be reassigned and as such we could place its value in a
stack slot or "register", avoiding 10,000 hashing operations and hash map
lookups. We could also notice that `i` does not escape its scope and could thus
also be placed in a stack slot and accessed through that, though this is already
mildly non-trivial[^2]. Still, these types of optimisations are a must-have for
a performant JavaScript engine, and I look forward to working on them.

Aside from that, property lookup inline caches are probably the most important
thing that an engine needs as it crosses into its "adulthood". In the above
example our property lookup `a[i]` is different on each iteration (and it is an
indexed property, though that is not relevant in Nova's case), but in a more
normal kind of loop it becomes very important indeed:

```js
let total = 0;
for (const rect of rects) {
  total += rect.width;
}
```

Currently, Nova would again perform a hash map lookup for both `total` and
`rect` inside the loop, and would perform a linear search for the `width`
property of the `rect` object each time as well. You can imagine that this is
quite a bit slower than what you'd hope for in a perfect world. This is where
inline caches come in: if we assume that all the `rects` objects have the same
(or similar) "shape" and that we can somehow check this "shape", then we can add
a "cache" at the lookup site that tells us what shape we expect the object to
have, and in such a shape what memory offset contains our property value. When
we lookup the same property on an object with the same shape, we can then
directly read the property value from the correct memory offset. This turns our
linear property search into a single shape value comparison (which I expect to
be a 32-bit integer in Nova), followed by a single memory read with an offset.

With basic versions for all of these optimisations in place, Nova should be able
to truly start showing what a data-oriented JavaScript engine heap design can
do. That will truly be a sight to behold, then!

## The hills behind the hills

Not everything I think about is strictly laid out in the project plan, not even
everything that I've discussed with NLnet directly. Beyond the project plan
itself, I have two, perhaps three personal plans in the making that could be
grouped together under the umbrella of "language evolution".

### "The sane subset"

The first personal plan of mine, which is already in motion, is for Nova to
offer various build-time subsetting flags for its JavaScript support. There are
many features and corner-cases in JavaScript that were perhaps ill-thought-out,
or were necessary evils. Some of these are simply odd corner-cases that don't
really matter much, but others do have concrete effects on either the language's
usability or engine's ability to optimise it.

For browsers and major JavaScript runtimes like Node.js, Deno, and Bun it would
be effectively impossible to unilaterally turn off a feature and go "you
shouldn't use this, don't @ me". Someone somewhere is relying on that feature,
no matter how weird of a corner-case it may be. But what about something like
those thousands of Electron and Tauri applications? Or some touch control panel
in a factory, running a custom WebView? Or a modding script in a computer game?
There, the possibility of turning off unneeded features in exchange for a
smaller binary, higher performance, less memory usage, faster garbage
collection, better reliability, or all of the above might be a real possibility.

And where Nova leads, others might follow. I don't want this to be some Nova's
custom thing that isn't documented in the least to the consternation of both
users and other engines who might be interested in offering the same or similar
features. What I want this to be is an alternative specification or a set of
patches on top of the normal ECMAScript specification. This way, if a "sane
subset" for JavaScript turns out to be of interest to embedders, then the same
subsets could still be easily run and tested on any engine, for the benefit of
all.

### Expanding Rust (alt: "The insane superset")

Contrary to what I am driving for in the JavaScript world, in the Rust world I
am still (mildly) on the side of expansion. When it comes to Rust, everyone and
their dog has at least one pre-pre-RFC in a backpocket somewhere, and if they
don't then they are at least subscribed to updates on one. For me, there are two
RFCs that I am very invested in.

The first one, and the one with the most chance of making it into the language
in any reasonable timeframe, is "reborrowing" or "autoreborrow traits". This has
to do with how Nova's garbage collector is set up, but at its core this is about
enabling user-defined types to work similarly to how `&mut T` works; a move-only
type that can be temporarily "loaned out" but "returns" to its owner afterwards.
If such user-defined types were possible, Nova's garbage collector would become
already a lot simpler to work with.

The second one is, of course, also related to our garbage collector and cuts at
the very heart of the borrow checker. Rust's borrow checker has a strict "1
exclusive XOR N shared" or "no mutable aliasing" ruleset for how references
work, which you have probably heard both praised and occasionally wailed at
often enough. Expect: this isn't really true. It's possible to derive multiple
shared references from a single exclusive reference, and use them and the
original exclusive reference at the same time, but only as long as you use all
of them as shared (immutable). Effectively, an exclusive reference can be
temporarily aliased within a single function body but once the exclusive
reference is used as exclusive then the usual "no aliasing" rule is asserted by
the borrow checker again.

What I want to do is to allow a function to say that it takes a mutably aliasing
set of references (or rather an aliasing lifetime), so that the borrow checker
will consider these references (where at least one should or must be exclusive
for this to make any sense) as usable as shared until any one of the is used as
exclusive, at which point all others invalidate immediately. This kind of
function would then be safely callable with aliasing references. This would
enable Nova's garbage collector to become nearly 100% automatic and ergonomic,
something that cannot really be said about it today.

## Human-machine interface

It might come as a surprise, but the people you read about on the Internet are
not simply ghosts, ghouls, or NPC characters floating about in the ether (except
for the chatbots). I too have been known to have a vibrant, even at times
interesting life outside of my day job and my work on Nova. It might but
shouldn't come as a surprise that this life is going to be affected by the NLnet
grant and this 6 month time "working for the Internet" as NLnet put it.

So far, I have found myself adjusting quite well to working from home once more.
I am more of a "return to office" person who only worked from home during the
worst parts of COVID, so cooping up in my study is a bit of a change. But that's
not what the biggest change to me is.

The biggest change is the most basic thing of them all: I have been working on a
salary for 10 years, and have gotten very accustomed to a regular schedule and
income. Working on a grant means that I am now both much more free than I am
normally, but also much more bound by what I do and achieve. If I spend a month
recreating Nova's heap on top of direct page table layout manipulation, I may
created something truly useful, but as it is not one of my grant goals I will be
that much poorer for my efforts.

Similarly, this past weekend I caught a bad cold and was out cold for three
days. On salary under Finnish employment law this would have been no real issue:
I'd rest at home and get paid regardless. On a grant I can instead only hope
that the illness does not persist and I will get back on my feet soon enough
that the lost time and working hours don't come back to bite me in the behind.

Right now I am still not too worried, but it is undeniable that I am much more
focused on simply taking tasks from the plan than before. Mostly that is because
the plan is what I wanted and intended to do, but some of it is also because
that is the path forward for me if I want to keep buying bread. Of course, NLnet
isn't an inflexible, faceless organisation in this; if I believe that a change
to the plan should be made, they may well accommodate me and allow that change.
Yet, I should not rely on that.

So, that's where Nova is today: being built day-by-day by yours truly, thanks to
the generous grant from NLnet (and the European Commission). If you're
interested in following along, the commits are coming in daily on GitHub and our
Discord server is open. Ask me nicely and maybe I'll even start code-streaming,
who knows? Until next time!

[^1]: For each iteration of the loop, `i` is accessed once for the comparison,
    once for the increment, once for the property access, and once for the
    assignment, for a total of 4 times. `a` is accessed once for the property
    access, bringing the total number of accesses to 5.

[^2]: If the user has access to a debugger (which Nova currently does not
    support but eventually must) and they add a breakpoint inside the loop while
    the loop is executing, then they must be able to access `i` and `a` by name.
    Accessing `a` is not a problem as it is immutable; we can duplicate the `a`
    reference in the hash map and the stack slot with no issue. Accessing `i` is
    a problem, as we'd need to somehow map the stack slot and the name together.
