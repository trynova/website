---
title: Internals of Nova Part 2 - Rows for the Row God, Columns for the Column Throne!
description: Looking at more of the secret sauce that makes Nova.
date: 2024-09-14
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

[Last time](./internals-of-nova-part-1.md) I talked about how non-ordinary
objects in Nova delegate their object features to a "backing object". This
allows JavaScript's "exotic objects" to focus on the features that they are
meant for and not get bogged down in the details that is JavaScript objects.
This saves us some memory on every exotic object, but there is nothing
particularly amazing about this trick. Any old engine could do the same thing
and reap the same benefits.

This time I will delve into the foremost idea behind Nova's heap structure, and
the thing that really sets Nova apart from a traditional engine design. This
idea is also what has driven me to dedicate my time to Nova. That idea is the
"heap vector", an idea inspired by the
[entity component system](https://en.wikipedia.org/wiki/Entity_component_system)
architecture and
[data-oriented design](https://en.wikipedia.org/wiki/Data-oriented_design) in
general.

Let's skip right to the punchline! We'll go take a look at the aspirational heap
structure of Nova, then come back for the reasons later. So buckle in and
prepare yourself, this might sting a little before it gets better. I promise
you, it will feel good in the end.

## Storing things in vectors, the old fashioned way!

Nova's heap is built around vectors. We do not have any fancy half-space copying
garbage collector, no interesting nursery heap split apart from the old space
heap, no object header explaining what a particular heap item is, no tombstones
for relocations... We only have a bunch of vectors that are managed quite
plainly and simply. Each kind of heap data, be it a Symbol, String, Number,
ordinary Object, Array, Map, Set, ... has its data saved in its own "heap
vector". A JavaScript Value in Nova is then a type tag which tells which heap
vector to access, and an index into the vector. Everything else flows from
there.

So what do should these heap vectors hold? Let us go for a stroll.

### Array heap data

First we look at my favourite exotic object in all of JavaScript: The humble
Array. The way I want to eventually store the data for all Arrays alive in the
heap is this:

```rs
/// One-based index into ArrayVec
///
/// Note: NonZeroU32 is used to make Option<Array> the same size as Array.
struct Array(NonZeroU32);

#[repr(C)]
struct ArrayHeapData<const N: usize> {
    /// a u32 index into Vec<ElementsHeapData<cap>>
    elements: [ElementIndex; N],
    /// length of the Array
    lens: [u32; N],
    /// u8 identifier of elements capacity, and writability of length
    caps: [ElementCapacityWritability; N],
}

struct ArrayHeapVector {
    // Note: Invalid Rust, 'cap' cannot be referred to as const generic. This
    // is only to show the idea.
    ptr: *mut ArrayHeapData<cap>,
    // Note: Use u32's as we index using u32; usize would be unnecessarily large.
    len: u32,
    /// Number of ArrayHeapData that were allocated behind ptr, ie. the size of
    /// the ptr allocation.
    cap: u32,
    backing_objects: HashMap<Array, OrdinaryObject>,
}
```

Our Array "heap vector" is a pointer to three sequential arrays of data of
`ElementIndex` (a `u32`), `u32`, and `ElementCapacityWritability` (a `u8`). (For
the #dark-arts folks out there: These should actually be `MaybeUninit<T>` for
each slice. I'm saving keystrokes.) A single Array owns one index from each
slice, meaning that effectively an Array's static data is made up of
`(ElementIndex, u32, ElementCapacityWritability)`, which is 9 bytes in total (we
get to ignore padding because of the homogenous slices). This is effectively an
in-memory database of three data columns, where each Array owns one row in the
database.

Additionally, I want to keep a `backing_objects` HashMap on the side. The
purpose for this is to act as something of a scratch memory for those Arrays
that make use of their object properties. That is, Arrays that have named
properties set on them or that have prototypes that differ from
`Array.prototype`. The absolute majority of Arrays do not have these and thus we
avoid the need to allocate any memory for them in this way. This does assume
that we can know the proper Realm in which the Array was created in, but if we
have a separate Heap for each Realm then this is trivially knowable. Firefox's
SpiderMonkey has precisely this sort of setup, so we can probably follow their
lead on this without much issue.

This is unfortunately not reality yet. Currently Nova's Array heap vector looks
like this:

```rs
struct ArrayHeapData {
    /// NonZeroU32, 1-based index to Vec<ObjectHeapData> or 0 for None
    backing_object: Option<OrdinaryObject>,
    /// NonZeroU32, 1-based index to Vec<ElementsHeapData<cap>>
    elements: ElementIndex,
    /// u8 identifier of elements array capacity (powers of two)
    cap: ElementCapacity,
    /// value of this Array's length property
    len: u32,
    /// writable flag of this Array's length property
    len_writable: bool,
}

type ArrayHeapVector = Vec<ArrayHeapData>;
```

Each Array again owns one index in the `ArrayHeapVector` but the Array's data is
all held together. This is somewhat simpler to reason about and much easier
write out in code than the slice-based one up above. That being said, this is
also very likely to have worse performance: This struct's size is larger because
of padding bytes, the backing object index held within, and loading one of these
data points loads all the others regardless of if they're necessary or not.

### Object heap data

In the same vein, what I want our Objects to look like is this:

```rs
/// One-based index into ObjectVec
///
/// Note: NonZeroU32 is used to make Option<OrdinaryObject> the same size as
/// OrdinaryObject.
struct OrdinaryObject(NonZeroU32);

struct ObjectHeapData<const N: usize> {
    /// a u32 index to Vec<Shape>
    shapes: [Shape; N],
    /// a u32 index to Vec<PropertiesHeapData<cap>>
    properties: [PropertiesIndex; N],
    /// number of properties currently used
    lens: [u32; N],
    /// u8 identifier of properties capacity, and extensibility of the object
    caps: [PropertiesCapacityExtensibility; N],
}

struct ObjectVec {
    ptr: *mut ObjectHeapData<cap>,
    len: u32,
    cap: u32,
}
```

Each Object owns one index of the `ObjectHeapData` slices, so each Object has a
`Shape` (a `u32`), a `PropertiesIndex` (a `u32`), a `u32` length, and
`PropertiesCapacityExtensibility` (a `u8`). That makes a total of 13 bytes. The
`Shape` value is an index to a heap vector of Shapes, also known as
[hidden classes or Maps](https://v8.dev/docs/hidden-classes). These are data
structures that describe the shape of an object, ie. its prototype and keys.
They help reduce memory usage of objects by deduplicating the repetitive parts,
and they make caching of prototype property access (such as class method
accessing) possible. Nova does not currently have Shapes, but they are an
absolute necessity for any JavaScript engine that hopes to have good performance
under real-world workloads. We could even bring down the size of an individual
object to only 8 bytes if both the length and `PropertyCapacityExtensibility`
were handled by the `Shape`, but this would require creating somewhat more
`Shape` variants.

And as with Arrays, Nova's Objects are currently not yet split into slices like
this. It is also not guaranteed that it makes sense to split all of the fields
apart like this: It all depends on the memory access patterns of the program,
which in a JavaScript engine's case depends on the JavaScript code being run.
Still, I want to build the engine in this way.

## Rows for the Row God, Columns for the Column Throne!

So that was Arrays and Objects. These are the most common objects, so it makes
sense to put some effort into these. But surely I won't ask for the same work to
be put into every kind of object? Surely I don't want to create a separate
in-memory database table for each kind of object?

Yes! That is exactly what I want! As long as performance measurements show
improved or roughly equal performance, rows and columns is what I want to do.
The more the merrier!

"But why?", you ask. Well, let me tell you: The reason is cache efficiency and
memory savings. Every pointer we replace with an index saves us 4 bytes. Every
pointer that we entirely eliminate from the common case saves us 8 bytes. In
Node.js, an Array is 32 bytes and the smallest possible Object is 24 bytes. In
Chromium where V8's
[pointer compression](https://v8.dev/blog/pointer-compression) is used, this
halves to become 16 bytes for an Array and 12 bytes for an Object. Compare those
numbers to 9 and 13 bytes for Nova: We lose by one byte on Objects when pointer
compression is turned on (unless we move more data to the `Shape` as mentioned),
but on Arrays we cut the memory usage nearly in half! That is nothing to sneeze
at!

Saving parts of the heap data in separate slices also means that iterating over
large quantities of Arrays or Objects to access parts of them loads into the CPU
cahce only those parts that are truly needed. The parts that are not needed do
not get loaded "on the side", and do not pollute the CPU cache. Instead what
gets loaded is other equivalent parts of "nearby" objects of the same type;
these are the most likely thing you'll be accessing next during your iteration
and hence loading them in is a blessing, not a curse.

As an example, imagine iterating over an Array of Arrays to calculate the
combined length. Perhaps you're interested in the sum total of items with the
intention of pre-allocating a single Array or TypedArray to store results into
directly. Your code might look like this:

```ts
const result = arrays.reduce((acc, arr) => acc + arr.length, 0);
```

In Chromium we can count that each entry in `arrays` takes 4 bytes. Then,
loading the `arr.length` loads each Array's data into memory which takes 16
bytes out of a 64 byte cache line. We can assume that all the Arrays that
`arrays` points to are located right after the other in memory and are correctly
ordered, so the cache line contains 4 `arr.length` values. So for every 16
Arrays in `arrays` Chromium needs to load one more cache line to get the `arr`
reference, and for every 4 Arrays Chromium needs to load one more cache line to
get the `arr.length` value. `N / 16 + N / 4 = 5 * N / 16` is thus the number of
cache lines loaded. The actual data used is 4 bytes for the `arr` reference and
4 bytes for the `length` value, for a total of `8 * N` bytes used. The rate of
bytes loaded to bytes used is then `16 * 8 * N / 64 * 5 * N = 0.4`. That is a
40% utilization of the loaded data. (With Node the utilization would be 25%.)

For Nova each entry in `arrays` takes 8 bytes. Using the same assumptions as
above, we see that for every 8 Arrays in `arrays` Nova has to load one cache
line for the `arr` reference, and then for every 16 Arrays a cache line has to
be loaded for the `arr.length` value. Every `arr` reference in this case is
effectively a `(u8, u32)` which means that 3 bytes are padding and we won't
count them as used. The number of cache lines loaded is then
`N / 8 + N / 8 = N / 4`, and the data actually used is 5 bytes for the `arr`
reference and 4 bytes for the `length` value, for a total of `9 * N` bytes used.
The rate of bytes loaded to bytes used is then `4 * 9 * N / 64 * N = 0.5625`,
for a 56% utilization of the loaded data. This doesn't seem like a massive
number, but it is a 40% relative increase compared to Chromium. This is not half
bad!

## Data-oriented design

We finally come to the elephant in the room. Nova titles itself as a
"data-oriented JavaScript engine" or as "following data-oriented design
principles", and with the above we've seen a glimpse into what I mean by that.
But... what does that "data-oriented design" actually mean? And how is that
connected with the stuff you just read through?

Data-oriented design as meant by
[Mike Acton in 2014](https://www.youtube.com/watch?v=rX0ItVEVjHc) (terrific
talk, watch it every night before bed!) is boiled down to the following points:

1. As a matter of fact, the purpose of all programs and all parts of those
   programs is to transform data from one form to another.
2. If you don't understand the data you don't understand the problem.
3. Conversely, you understand the problem better by understanding the data.
4. Different problems require different solutions.
5. If you have different data, you have a different problem.
6. If you don't understand the cost of solving the problem, you don't understand
   the problem.
7. If you don't understand the hardware, you can't reason about the cost of
   solving the problem.

He also gives the following rules of thumb for thinking in terms he finds
important or useful:

1. Where there is one, there are many. Try looking on the time axis.
2. The more context you have, the better you can make the solution. Don't throw
   away data you need.

The idea for the heap design came from me hearing about the entity component
system architecture, which then lead me into data-oriented design which then
again lead me to refine the heap design. For me and for Nova this means looking
at what JavaScript code actually does for the most of the time: The bottleneck
of your JavaScript program is never a mathematical calculation or a single
property access. It is always a for loop, a map over an array, perhaps a
recursive algorithm: Each iteration repeats the same actions, most if-statements
take the same branch each time. The things that mainly happens in these
repeitions is reading Object properties or reading Array indexes. Every extra
byte being loaded during these steps evicts more cache, which means that more
cache lines need to be re-read alter, which evicts more cache.

An engine's purpose is to take the current JavaScript heap state and run the
next code step on it to create the next heap state. The less data this
transformation needs to touch, the better it works. And most JavaScript objects
are used in very particular ways: Arrays are usually dense and have no named
properties, Objects usually have no indexed properties, Maps and Sets and
ArrayBuffers and others usually have no properties at all. All of these (with
the exception of class Objects) usually have the realm's default prototype.

The backing object idea tackles the latter point; we can move object features of
Arrays, Maps, Sets, and ArrayBuffers behind an optional backing object pointer.
The common case then does not need to spend memory on being an Object. The heap
vector idea tackles the former point. The smaller we can make an Array or an
Object, and the better we can split out parts that common operations do not
touch, the better those common operations perform.

Data-oriented design does not offer any new, surprising ideas. It is simply a
return to the roots of asking: What is it that I am actually doing? How can I do
it as efficiently as possible with the resources that I have (in a reasonable
manner)? It is about first principles thinking. And this is the heap structure
that it lead me to design and explore.
