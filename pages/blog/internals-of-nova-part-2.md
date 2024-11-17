---
title: Internals of Nova Part 2 - Rows for the Row God, Columns for the Column Throne!
description: Looking at more of the secret sauce that makes Nova.
date: 2024-10-07
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

[Last time](./internals-of-nova-part-1) I talked about how non-ordinary
objects in Nova delegate their object features to a "backing object". This
allows JavaScript's "exotic objects" to focus on their core features and avoid
getting bogged down in the details of JavaScript object-hood. This saves us some
memory on every exotic object, but there is nothing particularly amazing about
this trick. Any old engine could do the same thing and reap the same benefits.

This time I will delve into the foremost idea behind Nova's heap structure, and
the thing that really sets Nova apart from a traditional engine design. This
idea is also what has driven me to dedicate my time to Nova. That idea is the
"heap vector", an idea inspired by the
[entity component system](https://en.wikipedia.org/wiki/Entity_component_system)
architecture and
[data-oriented design](https://en.wikipedia.org/wiki/Data-oriented_design) in
general.

Let's skip right to the punchline! We'll take a look at the aspirational heap
structure of Nova, then come back for the reasons later. So buckle in and
prepare yourself, this might sting a little before it gets better. I promise
you, it will feel good in the end.

## After a few moments, I perceived a line of data with purpose

Nova's heap is built around homogeneous vectors of data. We do not have any
generic heap objects, heap object headers, no tombstones for relocations, no
interesting nursery heap split apart from the old space heap, no fancy
half-space copying garbage collector... We only have a bunch of vectors that are
managed quite plainly and simply. Each kind of heap item, be it a Symbol,
String, Number, ordinary Object, Array, Map, Set, ... or other has its data
saved in its own "heap vector". A JavaScript Value in Nova is an 8-bit type tag
which tells which heap vector to access and a 32-bit index into the vector.
Everything else flows from there.

So what should these heap vectors hold? Let us go take a look.

### Array heap data

First, let's look at how I want to eventually store the humble Array in Nova's
heap:

```rs
/// One-based index into ArrayHeapVec
///
/// Note: NonZeroU32 is used to make Option<Array> the same size as Array.
struct Array(NonZeroU32);

#[repr(C)]
struct ArrayHeapData<const N: usize> {
    /// a u32 index into ElementsHeapDataVec<CAP>, where CAP is determined by
    /// the corresponding ElementCapacityWritability datum.
    elements: [ElementIndex; N],
    /// length of the Array
    lens: [u32; N],
    /// u8 identifier of elements capacity, and writability of length
    caps: [ElementCapacityWritability; N],
}

struct ArrayHeapVec {
    // Note: Invalid Rust, 'cap' cannot be referred to as const generic.
    // This is only to show the concept.
    ptr: *mut ArrayHeapData<cap>,
    // Note: Use u32's as we index using u32; usize would be unnecessarily large.
    len: u32,
    /// Number of ArrayHeapData that were allocated behind ptr, ie. the size of
    /// the ptr allocation. This is the `<cap>` above.
    cap: u32,
    backing_objects: HashMap<Array, OrdinaryObject>,
}
```

Our Array "heap vector" is a pointer to three sequential arrays of
`ElementIndex` (effectively a `u32`), `u32` length, and
`ElementCapacityWritability` (a `u8`). (These should actually be
`MaybeUninit<T>` for each slice but I'm saving keystrokes.) An Array owns one
item in each slice (the index determined by its value), meaning that an Array's
heap data is effectively an `(ElementIndex, u32, ElementCapacityWritability)`
tuple, which is 9 bytes in total (we get to ignore padding because of the
homogeneous slices). You can view this as an in-memory database of three dense
columns.

Additionally a fourth sparse column of backing object references is needed. This
is the `backing_objects` hash map. Arrays with properties (aside from 'length')
or a non-default prototype require an entry in this column. The absolute
majority of Arrays do not have these and this way we avoid the need to allocate
any memory for them. This does assume that we can know the Array's Realm so that
we can create a backing object with that Realm's `Array.prototype` intrinsic but
if we keep a separate Heap for each Realm then this is not a problem.

While the above is what I want our Array heap to eventually look like, we are
not there yet. Currently Nova's Array heap vector looks like this:

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

type ArrayHeapVec = Vec<ArrayHeapData>;
```

Each Array again owns one index in the `ArrayHeapVec` but the Array's data is
all held together. This is somewhat simpler to reason about and much easier to
write out in code than the slice-based one up above. That being said, this is
also very likely to have worse performance: This struct's size is larger because
of padding bytes and the backing object index held within, and because it is not
split into separate slices loading one piece of data loads all the data. This
often leads to wasted memory bandwidth: Reading an Array's length does not need
any other data, and reading an element by index does not need the backing
object.

### Object heap data

In the same vein, what I want our Objects to look like is this:

```rs
/// One-based index into ObjectVec
///
/// Note: NonZeroU32 is used to make Option<OrdinaryObject> the same size as
/// OrdinaryObject.
struct OrdinaryObject(NonZeroU32);

struct ObjectHeapData<const N: usize> {
    /// a u32 index to ShapeVec
    shapes: [Shape; N],
    /// a u32 index to PropertiesHeapDataVec<CAP> where CAP is determined by
    /// the crresponding Shape.
    properties: [PropertiesIndex; N],
}

struct ObjectVec {
    ptr: *mut ObjectHeapData<cap>,
    len: u32,
    cap: u32,
}
```

Each Object owns one index of the `ObjectHeapData` slices, so each Object has a
`Shape` (a `u32`) and a `PropertiesIndex` (a `u32`) for a total of just 8 bytes.
The `Shape` value is an index to a heap vector of Shapes, also known as
[hidden classes or Maps](https://v8.dev/docs/hidden-classes). These are data
structures that describe the shape of an object, ie. its prototype and keys.
They help reduce memory usage of objects by deduplicating the repetitive parts,
and they make caching of prototype property access (such as class method access)
possible. Nova does not currently have Shapes, but they are an absolute
necessity for any JavaScript engine that hopes to have good performance under
real-world workloads.

Shapes are usually fairly large data structures, as they take up responsibility
for much of the complex and dynamic parts of JavaScript objects. Increasing
their number without limit is generally not a good idea. We can slim down Shapes
and somewhat limit their number by eg. moving the `extensible` flag and/or the
`CAP` value of the Shape into the index part itself at the cost of supporting a
smaller maximum number of Shapes in the engine.

And as with Arrays, Nova's Objects are currently not yet split into slices like
this. It is also not guaranteed that it makes sense to split all of the fields
apart like this: It all depends on the memory access patterns of the program,
which in a JavaScript engine's case depends largely (but not only!) on the
JavaScript code being run.

In Object's case, reading properties always requires reading both a `shapes` and
a `properties` value so we do not gain any direct benefit by splitting the two
values from each other. Reading the Object's shape still benefits as it does not
depend on the `properties` value and reading the shape is a common operation due
to prototype property access caching, but whether that is a worthwhile benefit
remains to be seen.

## Rows for the Row God, Columns for the Column Throne!

So that was Arrays and Objects. These are the most common objects, so it makes
sense to put some effort into these. But surely I won't ask for the same work to
be put into every kind of object? Or do I really want to create a separate
in-memory database for each kind of object?

Yes! That is exactly what I want! As long as performance measurements show that
it makes at least some sense, rows and columns is what I want to do. The more
the merrier! "But why?", you ask. Well, let me tell you.

The reason is cache efficiency and memory savings. CPUs do not load memory by
the byte, they load it by the cache line which is usually 64 bytes. Loading a
new cache line means that a previous cache line must be evicted from cache.
Every 8 byte pointer we replace with a 4 byte index saves us 4 bytes. Every
pointer that we entirely eliminate from the common case saves us 8 bytes. Every
byte we load into CPU cache despite knowing it is unused by the current
operation is always either wasted work spent evicting an old unnecessary byte to
make room for a new unnecessary byte, or is an active loss if we evict an one
old byte that we were going to be using soon. With this in mind, we should
ensure that common operations do not load any unused bytes by splitting data
onto separate cache lines. This stops us from loading known unused bytes, and
instead loads adjacent data of the same type.

What does the adjacent data help then? Looking at an operation in a vacuum, it
does not help at all. But the code does not run in a vacuum, and the common
operation is not a one-off. It is likely to be repeated many times over, on
multiple related heap items. Because these items are related, they are likely to
have come from a single source and be allocated next to one another in memory.
The adjacent data will therefore likely contain the data we need to perform the
operation on the next item. Splitting apart things that we know we do not need
means we are more likely to load what we do need: We switch from loading known
unused bytes into loading maybe useful bytes. It is a blessing, not a curse.

Let's take an optimal example case: Iterating over an Array of Arrays to
calculate their combined length. Your code might look like this:

```ts
arrays.reduce((acc, arr) => acc + arr.length, 0);
```

In Node.js, a JavaScript Value is 8 bytes, an Array is 32 bytes and the smallest
possible Object is 24 bytes. In Chromium where V8's
[pointer compression](https://v8.dev/blog/pointer-compression) is used, these
numbers halve to become 4 bytes for a reference, 16 bytes for an Array, and 12
bytes for an Object. In Nova's (aspirational) case the numbers are 8, 9, and 8
bytes: Comparing to Chromium, our Value is double the size but we nearly halve
the size of Arrays and take one third out of Objects. Remember that the usual
cache line size (which is the smallest unit of memory that a CPU can really
load) is 64 bytes.

With this we can see that in Chromium each element (indexed property) in
`arrays` takes 4 bytes and loading the `arr.length` loads the Array's data into
memory which takes 16 bytes. This means that getting the `arr.length` in total
requires loading 20 bytes on average. Array's elements are usually allocated
sequentially, so in Chromium one cache line can fit 16 Array references (`arr`)
in `arrays`. Assuming that all the Arrays pointed to by `arrays` are
sequentially in memory, each cache line loaded by accessing `arr.length`
contains 3 other `arr.length` values for a total of 4. The number of cache lines
loaded is thus `N / 16 + N / 4 = 5 * N / 16` where `N` is the number of Arrays
in `arrays`. The actual data we really use to calculate the result is 4 bytes
for the `arr` reference and 4 bytes for the `length` value, for a total of
`8 * N` bytes used. The rate of bytes loaded to bytes used is then
`(8 * N) / (64 * (5 * N / 16)) = 0.4`. That is a 40% cache line utilization.
(With Node the utilization would be only 25%.)

For Nova each entry in `arrays` takes 8 bytes. Using the same assumptions as
above, we see that in Nova each cache line can fit 8 Array reference in
`arrays`, and that each cache line loaded by accessing `arr.length` contains 15
other `arr.length` values for a total of 16. Every `arr` reference in Nova is
effectively a `(u8, u32)` which means that 3 bytes are padding and dont't count
as used (note: this makes Nova's result look worse, not better). The number of
cache lines loaded is then `N / 8 + N / 16 = 3 * N / 16`, and the data actually
used is 5 bytes for the `arr` reference and 4 bytes for the `length` value, for
a total of `9 * N` bytes used. The rate of bytes loaded to bytes used is then
`(9 * N) / (64 * (3 * N / 16)) = 0.75`, for a 75% utilization of the loaded
data.

That is a massive increase in utilization. It is still worth noting that
increased utilization rate does not mean that the memory is necessarily used
well. Both utilization rate and actual memory usage should be considered, and
even that does not tell the whole story. But given that Nova (aspirationally)
achieves both a smaller Array memory footprint and a higher cache line
utilization rate, I do think it is fair to say that the vector based heap
structure is at the very least interesting.

## Data-oriented design

We finally come to the elephant in the room. Nova titles itself as a
"data-oriented JavaScript engine" or as "following data-oriented design
principles", and with the above we've seen a glimpse into what I mean by that.
But... what does that "data-oriented design" actually mean? And how is that
connected with heap vectors?

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

The idea for this heap design started when I heard about the entity component
system architecture. This lead me into data-oriented design which then again
lead me to refine the heap design. It lead me to look at JavaScript in a
statistical manner, to focus on the common case. It lead me to look at code and
algorithms in a larger context. A line of code, an algorithm, a function written
in JavaScript (or any other language for that matter) does not run once, and if
it does then its performance is effectively meaningless to the program's
runtime.

The bottleneck of your JavaScript program is never a single mathematical
calculation or a single property access. It is always a for loop, a map over an
array, perhaps a recursive algorithm: Each iteration repeats the same actions,
if-statements take similar branches on each loop. The main things in these
repeitions is reading and writing Object properties or Array indexes, doing some
mathematical calculations, and maybe calling some builtin functions.
Individually these are all fast, but put together they become slow. Often, the
reason for the slowdown is bad cache performance. Every byte loaded during these
actions evicts a byte from cache, which means that more cache lines need to be
re-read after, which evicts more cache. Eventually the CPU spends most of its
time just waiting for the next cache line to arrive so it can do a few trivial
instructions and go right back to waiting.

A Javascript engine's purpose is to take the current JavaScript heap state and
run the next code step on it to transform the heap state into the next state.
Most JavaScript code uses objects in very predictable ways: Arrays for their
indices, Objects for their named properties, Maps and Sets for hashing,
ArrayBuffers as allocation markers, and so on. It stands to reason that an
engine would take advantage of this predictability.

The backing object idea allows the engine to entirely skip dealing with the
object features of exotic objects that technically are objects but are very
rarely used as such. The heap vector idea allows the engine to move data into a
memory layout that better reflects what code is likely to do next instead of
having to keep things together because of the programmer's model of the
JavaScript language.

Data-oriented design is a way of thinking about and designing software that
tries to get to, or perhaps return to, the heart of what software is. It is
about solving engineering challenges on real-world machines, with real-world
data as your guide to the problem. Data-oriented design does not offer any new,
surprising ideas. It is a return to the roots of asking: What is it that I am
actually doing? How can I do it as efficiently as possible with the resources
that I have (in a reasonable manner)? It is about first principles thinking. And
this is the heap structure that it lead me to design and explore.
