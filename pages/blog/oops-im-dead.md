---
title: OOPs, I'm so dead!
description: Structural inheritance is problematic - fight me.
date: 2025-12-06
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Okay, okay, I know what you're thinking: what's this data-oriented design zealot
doing, opening their mouth about object-oriented programming? Don't they know
that OOP is alive, well, and keeps spawning more successful projects than any
other programming paradigm ever did, like Shub-Niggurath the Black Goat of the
Woods with a Thousand Young spawns progeny? And don't they know that basically
everything in programming _is_ actually OOP, including their favourite ML and
DOD features?

So, let's start off with some clarifications:

1. I'm not announcing the death of object-oriented programming, I just liked the
   title. Yes, it's effectively click-bait and I don't apologise because I like
   it and because it is an explicit reference.
1. I don't think object-oriented programming is the worst thing in the world,
   and I use things like classes regularly in the TypeScript I write as a means
   of putting food on the table.
1. I am about to complain about one particular programming language feature
   that, according to the Internet commentariat, is purely an implementation
   detail and has nothing to do with object-oriented programming. So, if you see
   yourself or your favourite programming language in the picture being drawn by
   this blog post, remember then that this is purely a coincidence and no
   object-oriented languages are being harmed by this blog post – only
   implementation details.

The thing we're talking about is of course structural inheritance. "What is
structural inheritance and how is it different from class inheritance in this
programming language?", I hear you cry. Let's define the term by counter-example
first: interface inheritance or typeclassing is a form of inheritance where a
"subclass" only inherits a set of behaviours from the "superclass"; structural
inheritance is then a form of inheritance where both behaviours and the _form_
of a superclass are both inherited.

Because we're talking about an implementation detail, let's try to make this
very concrete: structural inheritance (as I am talking about it) means
inheriting the memory layout of the superclass, such that a pointer to a
subclass instance can be directly used as a pointer to a superclass instance:
reading inbounds offsets from such a pointer will read exactly the same (kind
of) data regardless of if the pointer points to a subclass or superclass
instance.

This form of inheritance is what I will rail against today. Now, you've been
warned but I'll reiterate for safety: if you see yourself or your favourite
programming language in this definition, it is merely a coincidence. In
particular, languages that are not at all pointed to here include JavaScript[^1]
and C++[^2]. Now, let's grind that ax!

## Protego!

Structural inheritance isn't all bad: it is exceedingly convenient, easy to
understand, and works great for many things. A commonly cited example is GUIs
and how excellent inheritance is for modeling them, with structural inheritance
being implied by this praise.

A (hopefully uncontroversial) case for structural inheritance's superiority in a
GUI programming setting might come from defining the position of an element in a
GUI. The element needs to be drawn _somewhere_, so `left`, `top`, `width`, and
`height` properties of one form or another are simply required for all elements.
It then makes sense to put these properties in the base class of the GUI
library.

```typescript
class BaseElement {
  left: u32;
  top: u32;
  width: u32;
  height: u32;
}

class ButtonElement extends BaseElement {
  toggled: boolean;
}

class TextElement extends BaseElement {
  value: string;
}
```

In terms of memory layout, this sort of structural inheritance hierarchy means
that classes look something like this in memory:

```typescript
const BaseLayout = [u32, u32, u32, u32];
const ButtonLayout = [...BaseLayout, boolean];
const TextLayout = [...BaseLayout, string];
```

The base class fields are placed at the start of the subclass' memory layout;
note that the fields of the subclass are at the very end, despite probably being
the most important fields of the class. It isn't a given, but it can be slower
to load far-off fields.

This all looks pretty fine. Let's keep going then.

## Reducto!

If we think about a text element in a GUI, it's fairly common that it will only
take up the amount of space that it requires, up to some maximum at which point
it gets cut off with maybe an ellipsis added at the end. Now, how would we do
that in our GUI here?

The first obvious step is to introduce an extra wrapper around a `TextElement`:
that wrapping element defines the maximum space that the text can take, after
which ellipsis appears. Our `TextElement` itself then probably still has a
user-definable position somehow, but its `width` and `height` values become
dependent on the actual text value. Depending on the details of the system, at
this point the actual `width` and `height` properties might become unused as it
may be cheap enough to simply calculate the resultant size of the text from the
string dynamically. Even if that is not the case, the properties at the very
least become merely caches of calculated values: they are not the source of
truth that they once were.

Letting that simmer, what if we introduce a flexible box or grid layout element
into the GUI? The properties of our base element class might become entirely
irrelevant when placed in such a layout, yet they remain an integral part of the
memory layout of each instance. That is memory being used to store no
information whatsoever, just pure waste.

This isn't a deal-breaker of course: we can introduce a further base class
(maybe call it a `Node`?) that doesn't have these properties at all and can then
inherit from that to avoid the properties when we know they're not needed. This
is all just engineering and trade-offs, nothing fundamental that couldn't be
fixed. But at least we found an issue in the way we built our inheritance
hierarchy, if nothing else.

## The Curse of Structural Inheritance

Reusing the original GUI example, let's say our GUI gets an
`BinaryElement extends BaseElement` subclass that displays 32 bits in 0s and 1s
using a monospace font: calculating the width of this element is trivial, simply
multiply the monospace font's character width by 32. Now, it is clear that the
`width` property from our `BaseElement` is going to be unnecessary: we really
don't need to store the result of this calculation in memory, and we'd much
rather reuse that `width` property's memory to store the 32 bits that the
`BinaryElement` is displaying. Yet, this cannot be done.

Our `BinaryElement` is clearly an element in terms of interface inheritance: it
has ways to display some data in some location on the screen. But it is also
better defined, or has a more limited use-case, than a general element is: its
contents is known to be a binary number of 32 bits, and its size is known to be
a static value (modulo the monospace font). Yet, no matter how hard we try, we
cannot make the `BinaryElement` smaller than a `BaseElement` is; rather it must
be bigger to fit the 32 bits it displays.

Now, it would be fair to say that the inheritance hierarchy here is badly
designed, wrong, doesn't actually make sense, and has nothing to do with
object-oriented programming in the first place anyway. Also, wasting the 8 bytes
of the width and height properties is meaningless in the grand scheme of things
and thus the larger waste of time is thinking about this whole issue at a all.
And maybe it is, but that is not a universal truth: this is engineering, and it
is all about trade-offs. In a real-world inheritance hierarchy you'll probably
find that much more memory is being wasted, and the effect of it is not
insigificant. At some point you'll find that the cost of not thinking about this
issue is too high to bear.

This is the Curse of Structural Inheritance that I now offer for you to
understand. Whenever you look at a structural inheritance hierarchy, you will
see the effects of the curse: you will see the subclasses carrying around all of
the superclasses data fields at the start of their memory layout, while subclass
fields are relegated to the very end of the instance memory. You'll see the
subclass often barely even touching the superclass fields, as many of its
behaviours have been overridden in such a way as to make the generic superclass
fields' data redundant. You will see all this, yet be unable to do anything to
help it. It is already too late to help it.

## Structural inheritance in action

Okay, maybe structural inheritance has a downside when modeling behaviourally
related but otherwise unconnected objects. But what if the data is very clearly
linked, surely then structural inheritance is great? This is the question I was
asked recently: specifically, I was asked why I had not written two classes,
`GraphReadWrite` and `GraphReadOnly`, using inheritance but had instead opted to
create two entirely separate classes that largely shared the same internal field
structure and copy-pasted a good bit of methods on top! Surely this is a case
for inheritance?

The read-write class I wrote is used to create a graph step by step, and once
the creation is done it is "frozen" to produce a read-only instance: these
classes could alternatively be called a `GraphBuilder` and `Graph`, but our
`GraphReadWrite` still internally contains a graph. So while the graph inside of
`GraphReadWrite` may be incomplete, it is still a graph with nodes and edges and
methods to read them just like the final `GraphReadOnly` has, not a builder with
just add methods and a final `build` step that does all the work. So surely it
is stupid to duplicate code across the two classes? I had to pause to really
consider this question, but I did indeed find that I had an answer. Let's
approach it by trying to write out the inheritance hierarchy.

Oh, and do stop me if you know the answer already: it seems that trying to model
read-write and read-only class variants through inheritance has already been
tried in enough places so as to see that it is a fool's errand. I of course had
not found this out yet and so had to find my own answer.

So let's start by doing the logical thing and inheriting
`GraphReadOnly extends GraphReadWrite`. This seems clear and simple, we have a
superclass that includes all the fields and methods for storing a graph and
making changes to it, and our subclass simply makes those fields readonly and
overrides all the methods of the superclass to throw exceptions if called.
Except that the subclass cannot re-interpret the superclass fields, not even by
changing them from read-write to read-only: it can only pretend they are
read-only but it cannot actually change their functionality. Furthermore, a
subclass is a valid instance of a superclass, so any superclass methods can be
called on a subclass instance: this means that the read-write methods of
`GraphReadWrite` can still be called on a `GraphReadOnly`. The read-only
instance we have is not actually all that read-only, we're just trying to
pretend it is.

And I'm sure you saw the effects of the Curse of Structural Inheritance as well:
our superclass has fields "for storing a graph **and making changes to it**".
There is extra data in the `GraphReadWrite` superclass that is unnecessary when
we know that the graph is read-only (specifically, this was a couple of hash
maps for efficient insertion). The `GraphReadOnly` is paying the cost of
read-write features it never wants to use, while also having no actual
guarantees that it truly is read-only. Obviously this is no way to build a
reliable system, so we cannot go this route.

So, what we have to do is the opposite: `GraphReadWrite extends GraphReadOnly`.
Now everything works wonderfully, the `GraphReadOnly` superclass only includes
those fields that are needed to store a graph and none of the fields needed to
mutate it efficiently, while the subclass gets to introduce those extra fields
as needed (never mind that it still only has to add them at the end of the
memory layout despite them probably being the first thing accessed when a write
API is called). `GraphReadOnly` also gets to define its fields as read-only
while `GraphReadWrite` then mutates them inside its own methods. ... Wait,
what?! Oh right! Now the subclass has to break the read-only invariants of the
superclass to do its work: depending on the language this might appear as
const-casting or `// @ts-expect-error` comments. Any methods defined on the
superclass that rely on the read-only nature of these fields for correctness are
liable to bug out if any re-entrant code paths appear with subclass instances.
The language fights the implementation, and possibly the best way to resolve the
Gordian Knot is to simply give up on defining the fields as read-only in the
first place. At that point you are left with a `GraphReadOnly` class that is
read-only in name, but with no actual guarantees given. The entire point of the
class has arguably been lost in our attempt at using inheritance to model
read-only and read-write variants of the same data.

A third option would be to define a common base class between `GraphReadOnly`
and `GraphReadWrite` and have both classes inherit from that: depending on the
language this could remove some issues but I at cannot directly recall a feature
of inheriting a superclass as read-only. In effect, the common base class would
still need to be defined as read-write and `GraphReadOnly` would again have to
live with being read-only in name only.

At the end of the day, structural inheritance is not a tool that I like to use
all that much. When in doubt, I prefer interface inheritance and when I need
structural sharing, I tend to opt for either structural composition (including a
struct in your own definition; this doesn't exist in JavaScript), indirect
composition (including a pointer to a struct; this is equivalent to storing an
object inside an object in JavaScript), or a manual mix of the two.

Maybe consider doing the same the next time you see the Curse of Structural
Inheritance lingering in your code base?

[^1]: While JavaScript's prototypal inheritance is more akin to interface
    inheritance, the `class` keyword and field definitions especially but also
    traditional constructor functions that assign properties to `this` are a
    form of structural inheritance.

[^2]: The grand old man of structural inheritance and object-oriented
    programming as we mostly know and love it today! My expertise isn't here, so
    I should shut up but I'll just point out that non-abstract C++ classes are
    explicitly a form of structural inheritance.
