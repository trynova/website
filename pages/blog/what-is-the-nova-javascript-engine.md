---
title: What is the Nova JavaScript engine?
description: A cliff-notes version of what is going on here.
date: 2024-11-17
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Let me answer that question as quickly as I can without skipping too much of the
details: Nova is a JavaScript engine being built by me and a group of
compatriots that takes a data-oriented approach to engine design. This is most
concretely visible in our major architectural choices:

1. All data allocated on the JavaScript heap is placed into a type-specific
   vector. Numbers go into the numbers vector, strings into the strings vector,
   and so on.
2. All heap references are type-discriminated indexes: A heap number is
   identified by its discriminant value and the index to which it points to in
   the numbers vector.
3. Objects are also split up into object kind -specific vectors. Ordinary
   objects go into one vector, Arrays go into another, DataViews into yet
   another, and so on.
4. Unordinary objects' heap data does not contain ordinary object data but
   instead they contain an optional index to the ordinary objects vector.
5. Objects are aggressively split into parts to avoid common use-cases having to
   reading parts that are known to be unused.

Does that sound interesting? Read on and I'll expand on each point a little
before giving you a link to follow for a more in-depth exploration of the idea.

## Heap vectors

We use the name "heap vectors" for the type-specific vectors that make up Nova's
JavaScript heap. For the absolute most part, everything in the Nova heap is
allocated into heap vectors. The only things that are not placed into heap
vectors are things that do not require garbage collection (such as bytecode), or
things that we have not yet got around to placing in vectors.

The reason for using heap vectors is simple: The simple vector is by far the
most cache-friendly data structure in the world. Nova is an exploration into an
alternative world where JavaScript is aggressively cache-friendly, and we cannot
afford to perform heap allocations in a cache-unfriendly way if we wish to see
and create that new world. More in-depth information about heap vectors can be
found in [Internals of Nova Part 2][2].

## Heap references are typed indexes

With the heap vector system, it would not be at all safe to keep references to
heap data alive for any meaningful length of time: When a new heap number is
allocated, it might cause the numbers vector to grow which invalidates all
references to that vector. References, or pointers, have other downsides as
well: They are large in size and are often a source of vulnerabilities,
especially when used in complex ways like a JavaScript engine tends to require.

No, pointers we do not want and cannot have, so the only real option is to use
indexes. Indexes have a lot of benefits: They are small, work exceedingly well
together with our heap vectors, enable using the same value to index into
multiple heap vectors (or slices of the same heap vector), perform a form of
pointer compression automatically, and offer great protection from safety
vulnerabilities as reinterpreting an index as a different type changes both the
type and the memory it indexes into.

A disjointed rambling through Nova's garbage collection's present and future
touches a bit more on heap references, see [Taking out the trash][3]. The
[Internals of Nova Part 2][2] also expands on this a bit.

## Object-kind heap vectors and unordinary objects' heap data

Not all objects are the same: They differ in their usage and their capabilities.
An object-oriented reading of JavaScript objects' capabilities and the
ECMAScript specification would give you a clear and simple inheritance graph
where the ordinary object is the base object class, and Arrays, DataViews, Maps,
and others inherit from that. This class hierarchy creates an engine where each
`DataView` and `Map` contains at least 12 bytes of data it will approximately
never use: A logical inheritance relationship does not mean that the inheritance
makes any real sense.

In recognition of this, Nova has multiple heap vectors for objects: Each object
kind gets its own one. This also means that each object kind is entirely free to
choose its heap data representation. The only thing that unordinary objects must
do is to allocate a single optional heap reference index to point to the
ordinary objects vector: Effectively, an unordinary object is not an object at
all unless specifically requested. If the object features of an unordinary
object are required, an ordinary object is created to handle the details and its
index is stored in the unordinary object, giving it those object features at the
cost of an extra indirection.

This idea, which we call the "backing object", is explored more fully in
[Internals of Nova Part 1][1].

## Objects are aggressively split into parts

This is somewhat more of an aim for the future instead of current reality, but
allow me to give some easy examples: The `ArrayBuffer` object in ECMAScript
supports allocating up to 2^53 bytes of data. Most engines only allow a tad bit
over 2^32 bytes but nevertheless, the fact of the matter is that you need more
than 4 bytes to store that byte value. As a result, `ArrayBuffer` itself but
also `DataView` and all the various TypedArray variants like `Uint8Array` must
carry within them 8 byte data fields for byte offset, byte length, and even
array length. Now ask yourself, how often do you deal with ArrayBuffers larger
than 4 GiB? Not very often, obviously.

Here's another example: How often do you use detach keys in your ArrayBuffers?
You might be asking yourself: "What is a detach key?" and you'd be right to ask:
You cannot set that from JavaScript itself, it is only used by "certain
embedding environments" and thus you've very likely never used it. When is it
used then? When detaching, of course, and only when detaching. Same goes for the
maximum byte length of an ArrayBuffer: It is only relevant for resizable
ArrayBuffers, and only when resizing. Both of these fields are known to be
unused in common operations: They are merely polluting CPU cache.

In Nova we aim to split objects into parts to ensure that computationally
unconnected parts are also stored separately in memory. For some things like the
byte values of ArrayBuffers this means using a smaller data field to store the
data, and storing the rare large value in a hash table on the side. For other
things it might mean simply splitting an object heap vector into multiple
"parallel vectors" or "slices", pushing computationally unconnected parts to
different cache lines and thus stopping them from polluting the cache. This is
fleshed out in much more detail and with more aspirational goals in
[Internals of Nova Part 2][2], and a concrete example of this work in action is
found in [Data-oriented View][4].

## P.S.

That's all for now. Thank you for your taking the time to read this, and for
your interest in Nova! Hop onto our [Discord][5] to chat with us, and if you
want to contribute to the development on Nova then our [GitHub is this way][6]!

[1]: ./internals-of-nova-part-1
[2]: ./internals-of-nova-part-2
[3]: ./taking-out-the-trash
[4]: ./data-oriented-view
[5]: https://discord.gg/RTrgJzXKUM
[6]: https://github.com/trynova/nova
