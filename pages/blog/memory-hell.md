---
title: Memory hell
description: On the theoretical basis of garbage collection and memory ownership.
date: 2025-02-23
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

For a JavaScript engine, a garbage collector is one of those things one wishes
one could avoid but simply cannot. Luckily, garbage collectors are old hat at
this point: The Garbage Collection Handbook (which I just picked up from the
floor behind me, where it has been languishing for quite some months) gives
garbage collection a birthyear of 1958. We know exactly how this should be done:
We allocate memory, retain pointers to it, and have an algorithm track the use
of this memory and deallocate it once it is no longer used. That algorithm is
then called the garbage collector. Algorithms for garbage collection vary from
reference counting to tracing garbage collectors, but at the end of the day it's
all the same stuff. (It has even been shown that the two approaches are
equivalent fixed point algorithms; the first gives the greatest and the latter
the least fixed point.)

But wait: When we give out pointers to garbage collected data we don't mean for
the receiver to assume ownership over the memory. We don't even really mean for
them to freely access that data, necessarily. So, who owns that memory? What
happens to that pointer if the engine itself is shut off? Do we actually know
how to do garbage collection? Welcome to memory hell!

## Who owns that memory?

In any program that uses dynamic memory allocation, memory is always allocated
by someone and we call that someone the owner of that memory. That memory must
also be deallocated at some point. While it is possible to give away ownership
of memory, for the most part it is not done in a garbage collected engine so we
can ignore that part. Hence, we can say that the one who deallocates memory is
its owner, and is also the one who allocated the memory in the first place.

### Using the operating system allocator

Let's first take the simplest possible JavaScript engine: Every time an object
is created in the engine, we perform `malloc` to allocate the memory for that
object and retain a pointer to it. When the object is no longer needed, we must
call `free` on it. The answer to "who owns that memory" is "they who call free".
But who does that? If we use reference counting, then we could say that the data
owns itself: Decrementing the reference counter is a method operating on the
data itself and that method will call `free` if the count reaches zero. The data
calls `free` on itself and is thus its own owner, QED. Alternatively, we could
say that all referrers commonly own the memory but we'll take the Rusty road
here and go with the former interpretation: This is just a matter of semantics
after all.

What if we use a tracing garbage collector? Tracing is a global action,
performed over all live objects. In this case no object can call `free` on
itself as it cannot know by itself if it still has incoming references. The only
actor that can call `free` on an object is the garbage collector algorithm,
which is (in a general sense) a method of the JavaScript engine: Hence, the
engine owns the allocated memory. Note also that the engine must somehow be able
find the now-unneeded pointers to call `free` on (the simplest way to do this
would be to have a vector or hash map somewhere inside the engine). These object
pointers are likely stored inside the engine when the object is created, meaning
that `malloc` is called from a method of the engine that stores the pointer and
then returns an alias of it to the caller of this method. From a Rusty point of
view this then makes it quite obvious that indeed, the ownership of the memory
must be held by the engine. We could say that the engine holds `Box<Object>`s
(likely `Box:leak`ed) while the value returned from the create method is a
reference, or more likely a raw pointer, aliasing the `Box`.

### Amortising allocation of objects

You've probably been yelling this whole time that anyone who uses `malloc` to
allocate JavaScript objects is a fool and you might be right too. What we
instead want to do is to amortise allocation of objects; our engine will request
the operating system for pages of memory and then keeps track of both the pages
it has initialised and their contents. When it determines that a page is no
longer needed, it returns the entire page to the operating system, all at once.
Objects are created using a method on the engine that writes the object's data
into a page and returns a pointer to its location.

Who owns the memory now? The answer should be obvious: It is the engine. It is
the one calling `malloc` and `free` (or equivalent APIs) to allocate and
deallocate pages. Even reference counted data no longer owns itself; it cannot
call `free` on itself as it was never allocated with a `malloc` but is only a
part of a larger allocation. Instead, it must call out to the engine to let it
be known that it is no longer used. The engine can then choose to deallocate the
entire page. With a tracing garbage collector it's much the same as before, only
now untraced objects don't need to be explicitly `free`'d but can instead eg. be
put on a freelist for their memory to be reused later.

## What happens if the engine shuts down?

This question might seem silly at first: A JavaScript engine shutting down is
hardly a common thing so why worry? But it actually is a common thing: Every
time you close a browser window, press Ctrl+C in Node, or close a WebWorker, a
JavaScript engine shuts down. And note, I'm not trying to make you worry about
this but using it as an instructive scenario.

Let's say we have some of those object pointers from earlier left over. What
happens to them when the engine shuts down? Let's assume that our compiler has
allowed this code through, as otherwise the answer is a bit too boring. In this
case the pointer obviously doesn't magically disappear into thin air nor does it
become a null pointer; neither the computer nor the program at large can
magically guess that we have a pointer here that now points to an object
associated with a shut-down JavaScript engine.

If we're using the OS allocator and reference counting, then everything is fine:
Us holding the pointer guarantees that the reference count is non-zero and thus
the memory has not been deallocated (unless the engine's shutdown sequence
traces through all objects and forcibly deallocates them, regardless of their
current reference count). We can still dereference the pointer to read and write
data therein. That being said, the object is likely fairly useless by now: What
is a JavaScript object without an engine?

If our JavaScript engine owns all the memory, then this is where trouble begins.
We now hold a dangling pointer; the engine has deallocated all of the objects it
owned, whether they were allocated using `malloc` or were contained in pages
that the engine obtained from the operating system by other means. Dereferencing
the pointer will lead to undefined behaviour and possibly tears.

### Can we fix it?

In an weak (attribute, not moral) type system like, say, C or even C++ if we use
raw pointers, in the general sense we cannot fix this. A raw pointer does not
have the capability to, at compile time, restrict code from shutting down the
JavaScript engine while an object pointer still exists.

Yet, there is light at the end of the tunnel! And it's _not_ Rust! (We'll get to
Rust later.) The V8 engine has an optional system called "pointer compression"
which effectively takes our object pointer and chops off the top 32 bits. To
re-construct the object pointer we need only take the engine's "base pointer"
which is guaranteed to have 32 trailing zeroes, and perform a bitwise AND on the
base pointer and our compressed object pointer, zero-extended to 64 bits. (There
are some extra things but this is the basic system.) With this, accessing object
data always requires both the object "pointer" and the engine base pointer. This
sort of means that the engine cannot be shut down from underneath us (hands are
waving in the air because this isn't true, but let's not get hung up on petty
details).

But did you catch what we did there: We took a pointer and compressed it down to
32 bits through some guarantees that the engine gives us. But is that compressed
pointer now a pointer at all? If you were paying attention, you might have
realised that V8's compressed pointers are actually pointer offsets! And once
you realise that, you might start thinking that this is a bit like what Rust's
borrow checker keeps hitting you over the head with. So, it is probably time to
turn towards the elephant in the room: What is garbage collection all about and
why doesn't the borrow checker like it?

## Do we actually know how to do garbage collection?

Garbage collection algorithms are not secret techniques passed down by old monks
in remote temples: We absolutely have the algorithms to do it. But I would, only
somewhat tongue in cheek, argue that we do not actually know how to do garbage
collection in a correct manner. The mistake we've made is to conflate garbage
collected data and pointers. Pointers are absolutely excellent and in many ways
they cannot be beaten in convenience or efficiency. It is thus quite
understandable that we would want to hold pointers to garbage collected data.

But pointers are also terrible, ancient things of untold power which even the
greatest may not wield without trepidation. They are both the door and the key,
the means and the permission. They are the despot in a world yearning for a
separation of powers, and I argue that we should fix our mistake and get rid of
pointers to garbage collected data.

### The road to null is paved with dangling pointers

A pointer can always be dereferenced, it can be read and written through (MPU
notwithstanding). It can always be `free`'d, even if it might be entirely
asinine to do so. A pointer is, in a sense, both the door to data and the key to
open it. An engine that gives direct pointers to garbage collected data makes
the mistake of both telling where the door is and giving the key to open it. The
garbage collector was supposed to be the sole proprietor of the data, but must
now forever grapple with potential access coming from a caller that forgot to
courteously ask for permission before opening the door.

Of course, we can generally trust that most API users will follow the rules and
worrying about the door being opened is mostly a theoretical worry. But one
Monday it will cease to be so: Maybe it's someone mistakenly using a pointer
long after its data has been released by the garbage collector leading to a
crash in production, or maybe someone finds a way to exploit that pointer
leading to an RCE vulnerability. The day will come... Probably.

And even if that Monday never comes, we'll still forever be looking over our
shoulder because the chance is there. Because we gave the key to the door
instead of only telling the user where the door is. We let the users address
directly into memory that was ours only to govern. What's the fix then? If
you're thinking "handles", you'd be about right.

### Make offsets, not pointers!

One way to avoid giving users the key to the door is to use offsets instead of
pointers, like V8's pointer compression does. "But that's inefficient!" you
might cry. After all, a garbage collected system that does not use pointers will
need to calculate the effective address every time it wants to read a value's
heap data. This is thousands to millions of extra instructions every second
which sounds like a lot.

Except! A run-of-the-mill CPU today runs hundreds of thousands of millions of
instructions per second (no, I did not have a stroke), even a puny ARM Cortex
CPU performs thousands of millions of instructions per second, and effective
address calculations are so heavily optimised that they're sometimes even
preferred by compilers over normal arithmetic instructions. In effect,
calculating the effective address of a value's data is not free, it does have a
cost, but the cost is small.

And there are benefits to using offsets, too. They can be generally be stored in
a smaller amount of memory, which means less memory used overall, which means
better CPU cache performance, and staying in the L1 cache is often the most
important thing a program can strive for. Offsets also come with a lot of
possibilities for interesting extra schemes on top, like explicit tagging, and
implicit self-tagging.

If we take V8's compressed pointers as an example, they are 32-bit offsets from
the engine's base address. V8 always allocates data on the heap 8-byte aligned,
meaning that the bottom 3 bits of these offsets are always zero. The lowest bit
is used as an explicit tag to split the value into a 31-bit integer or a heap
offsets. The second lowest bit is additionally used by heap offsets to indicate
if the offset is a weak or strong reference. On top of this explicit tagging, V8
also uses implicit tagging of indices: If the offset value is below a certain
limit, it is a read-only compressed pointer. If the value is above a certain
limit, it points to the garbage collector's new space. Otherwise, it points to
the old space. (The last two are guesses of mine. I don't know for certain that
this is exactly how it works, but I have relatively strong reasons to believe
that this is at least partially correct.)

But wait, what about the third bottom bit? Good question! V8 could indeed shift
their compressed pointer values one bit to the right. This would double the
amount of memory they can index into, going from 4 GiB to 8 GiB, with basically
no cost except maybe slightly more complex instruction usage. (You don't need to
run to tell them about this great idea, they know already.) But if the offset is
shifted once to the right, it's no longer an offset, right? What is it then?
Easy: It's an index to an array of 2-byte data!

### Make indices, not offsets!

Instead of offsets, we can use indices. An index is effectively just a less
granular pointer offset, pointing to some array of data. But trading granularity
of access to memory indexing capability is not the only thing that using indices
provides.

In a V8-like system the heap data itself must contain a "heap header" or "vtable
pointer" that tells its type at runtime: When we index into the heap, we're
effectively reading a single index in an array without knowing exactly what that
address contains. For instance, in V8 JavaScript objects can have varying sizes,
so even if we know that we hold an index to an object, we need to read the size
of the object from the heap before reading any of its other data. In array index
terms, this would effectively mean that we first have to read the data at our
given index, and based on that data we are given a non-zero length which becomes
the range of our object, `[index..index+length]`. This is a bit convoluted, but
it does have the benefit that the data size doesn't have to be statically known.

But what if we don't index into a singular allocation or array? Well, then we
get a different kind of system. In this alternative system, a Nova-like system
if you will, the engine is made up of multiple arrays of strictly typed data;
how we find these extra arrays is not exactly relevant but it can be either
dynamic (array base pointer is read through the engine base pointer) or static
(array base pointer is at a static offset from the engine base pointer). The
important thing is that now the index must contain the information for which
array it indexes into, which we shall call the tag. Hence, I shall call these
"tagged indices". In this sort of system heap headers are no longer needed as
each array contains statically defined data, but this comes at a cost: Data in
these arrays can no longer have dynamic size. (Strictly speaking, this is not
true but doing so would somewhat undermine the benefits of the tagged indices.)

But we of course get benefits as well: Tagged indices can have different
granularity based on their tag. Their memory indexing capability is thus very
close to being unlimited for practical purposes (depending of course on the
storage size we choose). Having the type be defined by the value itself instead
of the heap data means that polymorphism can be resolved already at the initial
call site before any memory reads need to be performed, and subsequent work can
run monomorphic. It also means, sort of confusingly, that type confusion is no
longer a thing: We'll come to this a bit later. Finally, because we the array
being indexed is dependent on the type, we can even decide that a single type
indexes multiple (equally long) arrays: We can use Struct-of-Arrays to store the
data in the heap.

### So, who owns that memory? What happens if the engine shuts down?

We've come full circle and are back at asking the basic questions of memory
ownership. But now with offsets and indices, or in more general "handles" as one
might call these, the answers are very clear indeed. A handle cannot be
dereferenced on its own, all usage of it to access real memory requires access
to the engine's base pointer: The engine owns the memory. A handle cannot be
dereferenced on its own, if the engine shuts down then the handle becomes a
useless integer, fit only for performing integer overflow tricks with. (Well,
that is assuming that no one holds the engine pointer illegally but we have to
draw the line somewhere!)

With handles, we've finally managed to tell the user where the door to their
data is without giving them the key to open it. Or put another way, we've
separated the concern of memory ownership (always held by the engine) from the
concern of how to get access to it (given to callers as necessary). The engine
no longer needs to worry about illegal access to the memory it governs.

## Garbage collection in a handle-based engine

We've now established that, in my opinion, engines should get rid of pointers to
garbage collected values and adopt handles instead. Fine enough, this at least
means that values cannot be dereferenced without also having access to the
engine itself. But does that mean that we're fully safe now?

In a V8-like system with the heap itself determining the type of a value, we are
not fully safe. If the heap moves items around, it is possible that a stashed
value will now point to a location in the heap that does not actually hold a
heap header but instead holds plain old data belonging to some other heap
object. We are somewhat better off than we were with plain pointers, but we're
still not safe from use-after-free bugs. (This is also why we see type confusion
vulnerabilities in V8, though usually those relate to the heap object changing
unexpectedly instead of it moving.)

In a Nova-like system with tagged indices, we actually are fully type-safe! The
value index and its type tag are strongly tied together but its actual memory
address is determined by the engine and any change in the index will still point
to data of the same type: Even if the data has moved or the value index is
changed, it will still resolve into a pointer to valid data of the correct type.
(Assuming that we perform bounds check on the index, that is, which we of course
do.) If the tag is changed, then the value index will now be used to index into
a different array altogether which contains valid data for the new type implied
by the tag. No matter how the value is changed, it is not possible to
effectively cast a value to a different type without also changing what data it
points to. Put another way, reinterpreting a value as a different type does not
reinterpret its backing memory but instead changes the backing memory to
something matching the new type.

In Halvar Flake's
["Is this memory safety here in the room with us?"](https://docs.google.com/presentation/d/1-CgBbVuFE1pJnB84wfeq_RadXQs13dCvHTFFVLPYTeg/edit#slide=id.g2d91ac7ea23_1_135)
keynote presentation's slides (I'm eagerly awaiting a recording of the talk so I
can also watch it instead of just reading it!) he poses these questions for a
garbage collected heap accessed through indices (as opposed to pointer offsets):

- Who tracks the lifetime of elements in [the engine]?
- Have we just re-introduced use-after-free, but … “typesafe” use-after-free?
- What are the implications of this?
- What does memory safety but with typesafe use-after-free even mean?

I believe with all what we've gone through above, we can answer these questions
quite succinctly.

### Who tracks the lifetime of elements in the engine?

This is naturally the engine's or it's garbage collector's responsibility. This
is actually exactly equal to a traditional garbage collector using pointers. The
only difference is that the garbage collector also operates on these indices
instead of pointers. (Also note how this means that mark bits can be stored
out-of-band of the heap data: This is an interesting opportunity again.)

### Have we introduced "typesafe" use-after-free?

Assuming that we have no borrow checker ensuring that our indices are valid,
then we indeed have introduced typesafe use-after-free. (Nova is in the process
of adding lifetimes to handles to avoid this, but it's a bit manual and awkward.
No free lunch.)

### What are the implications of typesafe use-after-free?

The main implication is that UAF ceases to be a memory safety issue and instead
becomes an abstract virtual machine semantics violation in the engine. As an
example, let us say that we build a DOM representation on top of Nova and in
this representation we store a JavaScript object corresponding to the
`parentElement` property of an `HTMLElement` object, but we forget to tell the
garbage collector about this property. When the garbage collector runs, it might
move the `parentElement` object to a difference index (or remove it) but as it
does not know about our property, it cannot fix our `parentElement` property
value to point to that new post-move index. If that happens then the next time
we use the `parentElement`, we'll find that the parent element is different from
before, but crucially it is still of the same type.

### What does memory safety with typesafe use-after-free even mean?

At its core, it means that assumptions must be checked. The first assumption
that generally needs to be checked is that the index being used is overall
valid: This means that index access must be bounds checked. It should not be
possible for a use-after-free of a handle to read into memory that has been
cleared and possibly deallocated by the garbage collector.

The other assumptions that need to be checked are any that cannot be verified
based on purely the value's type and data. Going back to the DOM representation
example, Nova currently lacks a proper implementation for "embedder objects",
like DOM elements, but the "good enough for now" plan is to put all embedder
objects behind a single value type tag, with the data held in a single array.
This means that the array of embedder objects might hold various different
`HTMLElement`s but also other kinds of embedder objects like
`CanvasRenderingContext2D`s or whatever other objects that the embedder chooses
to create that cannot be represented only through built-in JavaScript objects.

In this sort of arrangement, the actual data of these embedder objects must be
allocated outside the array of embedder objects itself, as the embedder objects
must all have the same size. An embedder object array entry will thus contain a
pointer to the actual data, plus some way to recognise what the pointer points
to. (The Rusty way to do this would be to have a vtable pointer next to the data
pointer, ie. a dyn Trait fat pointer.)

Now, if the DOM representation makes an assumption that the embedder object that
`parentElement` points to is always an `HTMLElement` and it unsafely takes the
data pointer out and starts calling `HTMLElement` methods on it, then we have a
memory safety violation again. Before calling `HTMLElement` methods, the code
should check that the embedder object indeed is an `HTMLElement`. The second
possible memory safety violation comes from any assumptions that the
`HTMLElement`s methods might make due to it being accessed through a
`parentElement` property: Perhaps we call some
`unsafe fn for_all_children_unchecked` method that assumes it is only ever
called on an `HTMLElement` with children. We preface this call with a comment:

```rs
// Note: This call checks that `self.parent_element` is a valid embedder object
// pointing to an HTMLElement.
let parent_element: &HTMLElement = self.parent_element.get_reference(agent)?;
// SAFETY: `parentElement` necessarily has children
unsafe { parent_element.for_all_children_unchecked(|| {}) };
```

This seems correct and valid, except unless `self.parent_element` is a
use-after-free index, in which case the `HTMLElement` may not have any children
and now we're suddenly back in memory unsafety land.

Okay, but what about if the `get_reference` call fails? If our embedder object
points to some non-HTMLElement object, what do we do? Here we have two choices:
We can make the method panic, in which case we're quite safe indeed but must
suffer the consequences. Alternatively, we can make the method return and throw
an error into the JavaScript engine. In the latter case, the abstract semantics
of the JavaScript engine's virtual machine have been violated and we end up in a
confused state but again, crucially, without memory safety violations.

An example of what this could mean is that our `parentElement` no longer indexes
into an `HTMLElement` embedder object at all but instead points to an unrelated
`CanvasRenderingContext2D` embedder object that just happened move to that
index. This will likely make for a really freaky and hard-to-debug bug, and may
also very likely lead to a crash somewhere further down the line (eg. when our
browser developer tools try to render the `parentElement`'s HTML data in a hover
tooltip). But, again, as long as assumptions are checked then memory safety will
not be violated.

It is also worth remembering that Nova is currently in the process of making the
Rust borrow checker check for use-after-free of handles. The resulting system
will be manual and because of that, for the time being, not robust enough to
rely on as a safety guarantee. Yet, it does have the potential of eventually
making the above assumptions effectively verified at compile-time.

## To hell with memory

We have arrived at the end: I have outlined a veritable treatise on garbage
collection, what I think it means, and how it should be thought of and written.
At the end of the day you might think: What was this all about? I don't have a
great answer to that question, but I think it all boils down to the following
points:

Using pointers in a garbage collected system is rife with dangers and should
generally be done away with, replacing them with handles. (This actually isn't
even that radical of a notion in some regards: HotSpot JVM apparently started
giving away only handles to GC data 25 years ago in FFI calls because of how
often users would hang onto a pointer and then end up with a use-after-free due
to garbage collector moving or removing the data.) Even if you're not up to
replacing pointers entirely, you should start considering them as handles: They
should only be dereferenceable together with the engine base pointer, never
without it.

A type-safe virtual machine is one where pointers are replaced with handles
based on tagged indexes. Use-after-free in such an engine becomes a violation of
the machines abstract semantics but avoids violating memory safety. With a
borrow checker, even use-after-free of handles can be eliminated entirely. I'm
sorry to say, but through the act of writing this I have come to believe that a
borrow checker is a required piece of compiler technology for any language that
wants to survive the next 50 years.

The language that dominates the future of software development may not be Rust,
Rust's borrow checker is after all currently not even strong enough to encode
the features needed to do use-after-free checking of handles to garbage
collected data without some manual work, but it will be a language with a borrow
checker that will win the sweepstakes. The benefits of a borrow checker are
simply too great, and the downsides are only a matter of finding the right way
to frame your assumptions for it to check.

For example, Nova's handle use-after-free checking could equally well be applied
to checking that pointers to garbage collected data are not used after garbage
collection might have moved them. It can (and in Nova, is) also be used to
ensure that no JavaScript code could have run between the pointer being used to
determine its type based on the heap data, and using that type to assume things
about the heap data. In effect, even the usage of pointers in a garbage
collected engine can be made safe with a borrow checker, it just requires
realising that ownership of the memory and the permission to access and validity
of that memory are not fully synonymous, and must be encoded separately.

We have come full circle once again. We climbed out of the memory hell to find
light and are now ready to descend back into that darkness. Only this time we
know that the evils of hell cannot hurt us for we carry the light inside of us.
We will descend to memory hell without fear, holding hands with our memory now,
for the borrow checker is on our side!
