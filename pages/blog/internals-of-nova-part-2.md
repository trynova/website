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
allows "exotic objects" to focus on the features that they are meant for and not
get bogged down in the details that is JavaScript objects. This saves us some
memory on every exotic object, but there is nothing particularly amazing about
this trick. Any old engine could do the same thing and reap the same benefits.

This time I will delve into the foremost idea behind Nova's heap structure; this
idea is also what has driven me to dedicate my time to Nova. The name of this
idea is the "heap vector" but more generally what I am talking about is
[entity component system](https://en.wikipedia.org/wiki/Entity_component_system)
and [data-oriented design](https://en.wikipedia.org/wiki/Data-oriented_design).

## Data-oriented design

Data-oriented design is a software design pattern or philosophy originating from
the games industry, although one could perhaps argue that data-oriented design
is the original design philosophy of software in general. In an abstract sense,
a program is nothing more than input data and transformations that act upon said
input data. A program's function is then to perform those transformations and do
it as efficiently as possible (with some constraints, eg. developer time) to
produce correct output from the input data.

When we write a program, it is then fairly obvious that we cannot design the
correct transformations without knowing what our input and output is, and more
importantly we cannot design the transformations to be efficient without knowing
our input data. As the input changes, the transformations must change and thus
our program must change.

Data-oriented design's first tenet is thus that we must know our data. If we do
not know our data, we do not know the transformations we need to produce correct
output, and that transformation is eventually the program that we must write. If
we do not know our data, we do not know our problem. As developers, our job is
not to write software; our job is to write programs that solve the problem at
hand. If we do not know our data, we cannot do our job.

Our data is also not only the actual input data that your program eventually
receives. It also encompasses the computer that the program runs on: To write
efficient transformations, we must take into account the context of our
program's runtime. And in this sense, the most important thing in computers for
the past 30 years has been **The Cache**!

Processors have got massively faster over the last 30 years, and in the last 10
years they have gotten massively more parallel with both
[simultaneous multithreading](https://en.wikipedia.org/wiki/Simultaneous_multithreading),
[symmetric multiprocessing](https://en.wikipedia.org/wiki/Symmetric_multiprocessing),
and
[SIMD instructions](https://en.wikipedia.org/wiki/Single_instruction,_multiple_data).
At the same time, memory speeds have grown only modestly in comparison. The
result is that a single processor can often process information faster than can
be loaded from main memory. Programs often then end up bounded by the memory
latency, not by memory bandwidth and most especially not by CPU speeds.

To sidestep this issue, local memory caches have been added to the processors.
These caches are both closer to the CPU, reducing access latency from distance,
and more importantly use a
[faster, volatile memory technology](https://en.wikipedia.org/wiki/Static_random-access_memory)
than main memory. Fetching data from the main memory to the local caches is
slow, but once the data is there then re-fetching it is massively faster. A
program will often reuse the same memory multiple times over, and that memory
will then be accessed from caches, avoiding the need to load the data from main
memory.

To give concrete numbers, a main memory load takes approximately 200
nanoseconds. A local cache access takes between 1 and 40 nanoseconds, depending
on the cache level. That is up to two orders of magnitude better! And the effect
is generally additive: Loading data that is then used to load more data pays the
memory latency twice. Often a program will also have very deep memory load
trees, and at worst every branch in the tree pays the 200 nanosecond price: This
is what crashes and burns program performance in this day and age. It is not a
slow CPU bringing you low, nor a slow hard drive or a lack of memory. It is
often not an undersized GPU that grinds a game's performance to a halt: It is
memory loading, or "memory stalls", that ruins your day.

Data-oriented design is all about solving or at least mitigating this issue. To
do so, we must know our data and use that knowledge to minimize memory usage
which always improves cache usage, and we must take into account the CPU caches
when desigining our software. The important thing here is that a CPU loads data
into cache not byte-by-byte but in cache lines. This is usually 64 bytes at a
time, though recent CPUs have bumped this number up to 128 bytes.

```rs
#[repr(align(64))]
struct CacheLine([u8; 64]);
```

When we load a piece of data we load a full cache line into the CPU, no matter
how small a part of it we actually want to use. Loading this one cache line from
main memory takes 200 nanoseconds. Now, if we only use a single byte (or worse,
one bit!) of that data then the vast majority of the data loaded is wasted. What
we want is to ensure that as much of the cache line gets used, especially if we
are in a tight loop.

Let's take as an example an Array of Arrays in the V8 JavaScript engine.

```ts
const arr: Data[][] = await Promise.all(names.map(fetchDataForName));
```

Now say we are interested in how many `Data` entities there are in total: We
will loop over the `arr` Array, accessing each Array in it, and tallying up the
length:

```ts
const dataCount = arr.reduce((acc, dataArray) => acc + dataArray.length, 0);
```

In terms of memory access patterns, a V8 Array looks roughly like this:

```rs
struct Array(*mut ArrayHeapData);

// Size is 32 bytes in Node, 16 bytes in Chrome with pointer compression
struct ArrayHeapData {
    map: *mut Map,
    elements: *mut FixedArray,
    length: u32,
    properties: *mut FixedArray,
}
```

When we reduce through `arr`, we must first access the `elements`. In this case
it gives us roughly something like:

```rs
struct FixedArray<const N: usize> {
    length: usize,
    entries: [*mut ArrayHeapData; N],
}
```

From here we can chase each `*mut ArrayHeapData` to get to the `length` data
contained in each, which we then load and sum up.

It is fair to assume that most of these `ArrayHeapData` structs are located
close to each other: We shall assume that they are actually right next to one
another which means that we can fit two of them on one cache line (four in
Chrome). What we want out of each `ArrayHeapData` is a single `u32`, that is 4
bytes. This means that we use 8 bytes (16 in Chrome) of every 64-byte cache
line. That is a usage rate of 12.5%. In expert circles this is called "bad".

Because we assumed that all the `ArrayHeapData` are right next to each other,
the CPU will actually aggressively prefetch data for us during this reduce
action and we might find that we only pay the memory latency a few times, and
after that we are bound by the memory bandwidth. Hearing this, you might think
that we it is actually fine that the cache usage rate is so low: The CPU
prefetching handled any possible problems we might have otherwise had.

This is not so: Cache size is limited, and every cache line loaded is a cache
line evicted from memory. The more we fetch, the more we need to fetch later to
get back data that we lost but still needed. In a real world situation the
`ArrayHeapData` structs are unlikely to be right next to one another: Fetch
responses come back in unreliable order, and they themselves are objects that
get allocated onto the same heap as the `ArrayHeapData` do. We likely find that
the `ArrayHeapData` are each on their own cache line which further worsens our
already bad cache line usage rate, which again means that we load and evict more
cache lines.

"Well," you say, "there is nothing we can do about this. The Array must keep its
data together, there is no efficient way to store any of it out of band!" And
you'd be right if we assume that an Array's data is of equal importance, and
that the Array must be accessed by a pointer. Last time I explored what we stand
to gain if we let go of the assumption that all data is of equal importance.
This time I will explore what we stand to gain if we let go of the assumption
that an Array must be accessed by a pointer.

## Indexed data access

I will finally cut to the point: We shall access our Array not by pointer, but
by index (this is actually what V8 does for all heap elements in Chrome as well,
only it is a 4-byte index shared by all heap elements, counted from the heap
origin). In our heap we will have a "heap vector" of `ArrayHeapData`s, and each
Array owns one index in this vector:

```rs
struct Array(u32);

struct Heap {
    // ...
    arrays: Vec<ArrayHeapData>,
    // ...
}
```

This gives us a much better chance that our `ArrayHeapData` is located right
next to each other in memory: A fetch response object is not an Array, it won't
allocate in this heap vector and thus won't push our arrays "apart". But we're
still left with that abysmal 12.5% cache line usage. That is not an acceptable
number! What we want is to read _only_ the lengths and nothing more! Why cannot
we do that?

Well with a pointer we couldn't, but with an index we can: As long as multiple
vectors share the same indexing then we can use a single index to look into any
one of them. The naive approach is this:

```rs
struct Heap {
    // ...
    array_maps: Vec<*mut Map>,
    array_elements: Vec<*mut FixedArray>,
    array_lengths: Vec<u32>,
    array_properties: Vec<*mut FixedArray>,
    // ...
}
```

We manually make sure that these vectors stay equally long and that we do not
shuffle their contents (at least not without doing the same shuffle in each of
them). But this seems pretty bad, we now have 4 vectors that should just be a
single thing. We can improve on this with something like this:

```rs
struct ArrayHeapData<const N: usize> {
    maps: [*mut Map; N],
    elements: [*mut FixedArray; N],
    lengths: [u32; N],
    properties: [*mut FixedArray; N],
}
struct ArrayVec {
    // Note: Invalid Rust, 'cap' cannot be referred to as const generic. This is only to show the idea.
    ptr: *mut ArrayHeapData<cap>,
    // Note: Use u32's as we index using u32; usize would be unnecessarily large.
    len: u32,
    cap: u32,
}
```

With this we only have a single "vector" split into four homogenous slices. Now
when we load the length of an Array, we access the `lengths` slice at the index
of that Array. This loads a cache line which contains other `u32` length values
of arrays before and/or after our Array. Now, during our reduce when we load the
next Array's length it is likely going to be the Array next index over, or at
least a very close-by index, meaning that very likely the next length is already
available in the cache line we just loaded.

A single cache line fits 16 Array lengths and in the best case scenario it all
the Array lengths we reduce over are contained in the single cache line we load.
Even as the number of Arrays grows, our cache line usage may end up being
effectively 100%: If no other Arrays are being allocated during the fetching,
then all of the Array lengths we are accessing will be right next to one
another. Reducing over the lengths now becomes a fully CPU bound problem (and
JavaScript's operational semantics are really good at making seemingly simple
things so complex that the CPU will have its hands full).

## Taking the next step

Nova's heap is made up of "heap vectors" like shown above. Specifically, the
current status is that we use a plain old `Vec<ArrayHeapData>` instead of
actually splitting the `ArrayHeapData` into multiple homogenous slices. Instead
of the `Map` and `FixedArray` pointers like in V8, Nova's `ArrayHeapData` looks
roughly like this:

```rs
struct ArrayHeapData {
    /// u32 index to Vec<ObjectHeapData> or 0 as None
    backing_object: Option<OrdinaryObject>,
    /// u32 index to Vec<ElementsHeapData<cap>>
    elements: ElementIndex,
    /// u8 identifier of elements array capacity (powers of two)
    cap: ElementCapacity,
    /// value of this Array's length property
    len: u32,
    /// writable flag of this Array's length property
    len_writable: bool,
}
```

This is 16 bytes in total. Split into 5 homogenous slices this could be brought
down to 14 bytes through the removal of two padding bytes. Combining
`len_writable` into `cap` gets us to 13 bytes. But can we go lower? And should
we?

In the last installment I mentioned that the backing object needs to perform
double-duty as a `Realm` indicator for when the backing object hasn't been
created yet. If the Array knows what `Realm` created it by association, then we
can drop that need. This association would be a `Realm`-specific `Heap`.

If each `Realm` has its own `Heap` struct, then we do not need the backing
object's memory unless a backing object has specifically been created. This
means that the `backing_object` `Option` is most often `None`. Now, what is an
efficient data structure that can associate an index with a another index? Yes
indeed, a hashmap! In the future if Nova splits the singular `Heap` up into
multiple ones then we can move to the following kind of heap structure:

```rs
struct ArrayHeapData<const N: usize> {
    elements: [ElementIndex; N],
    lens: [u32; N],
    caps: [ElementCapacityWritability; N],
}
struct ArrayVec {
    // Note: Invalid Rust, 'cap' cannot be referred to as const generic. This is only to show the idea.
    ptr: *mut ArrayHeapData<cap>,
    // Note: Use u32's as we index using u32; usize would be unnecessarily large.
    len: u32,
    cap: u32,
    backing_objects: HashMap<Array, OrdinaryObject>,
}
```

Now the common case for a JavaScript Array needs only 9 bytes of memory.
Iterating over multiple Arrays to access one "part" of them only accesses those
parts and none of the others. Cache line utilisation heretofore unimaginable in
a JavaScript engine is attainable as easily as just writing the code. This ...
this could change things.

## Post scriptum: What about Objects?

Let's take a quick detour to Objects as well. First thing is that we drop out
the "elements" store from ordinary objects. Objects usually have named
properties, only rarely do they have indexed properties. If what you want is
indexed properties, then an Array is what you should use.

A `Map` like in V8 is still very much necessary, though we will call it a
`Shape`: Without shapes, a JavaScript engine cannot optimise prototype accesses
and that then means that calling prototype methods becomes _very_ expensive
indeed. That is then basically all we need, and here is what we're left with:

```rs
struct ObjectHeapData {
    /// u32 Shape index
    shape: Shape,
    /// u32 Properties index
    properties: PropertiesIndex,
    /// u8 capacity identifier, plus extensibilty of the object
    cap: PropertiesCapacityExtensibility,
    /// u32 count of properties in object
    len: u32,
}
```

Performing the same splitting as with `ArrayHeapData` above get:

```rs
struct ObjectHeapData<const N: usize> {
    shapes: [Shape; N],
    properties: [PropertiesIndex; N],
    lens: [u32; N],
    caps: [PropertiesCapacityExtensibility; N],
}
struct ObjectVec {
    ptr: *mut ObjectHeapData<cap>,
    len: u32,
    cap: u32,
}
```

As a result, a single Object takes 13 bytes. At present, Nova does not have
`Shape`s and instead we have a `keys: KeysIndex` and a
`prototype: Option<Object>`, so this is more aspirational than reality.

### Does it actually make sense to split everything apart?

No, not necessarily. To access one object's any one property, we need to access
the `properties` index, `cap` identifier (this identifies the right properties
heap vector to index into), and the `len` value to check the bounds of the
properties array that we access into. When we read a single object's single
property this splitting means that we read four cache lines to access a single
JavaScript Value, which in Nova is 8 bytes in size. That is a cache line
utilisation rate of 3%.

This is absolutely terrible, but on the other hand 3 of the 4 cache lines can be
loaded in parallel (they have no data dependency on each other) and most
importantly this is a one-off case that we are looking at. A singular case's
performance is meaningless, only when the singular case is considered in the
context of either doing the same thing over and over again on the same data, or
over and over again on multiple data does the performance have any meaning.

The absolute worst case scenario for the above (inspirational) Object heap
vector is mapping over multiple objects that are so far away from each other
that their data never appears on the same cache line. For the `u32` sized parts
(shapes, properties, lengths) that would be 16 indexes or more apart, and for
the `caps` part that would be 64 indexes or more apart. We can imagine such a
mapping scenario to happen with the following kind of structure:

```ts
interface Data {
  x: number;
}

interface Collection {
  a: Data;
  b: Data;
  c: Data;
  d: Data;
  e: Data;
  f: Data;
  g: Data;
  h: Data;
  i: Data;
  j: Data;
  k: Data;
  l: Data;
  m: Data;
  n: Data;
  o: Data;
  p: Data;
}

const arr: Collection[] = [
  { // Object index 16
    "a": { "x": 0 }, // Object index  0
    "b": { "x": 0 }, // Object index  1
    "c": { "x": 0 }, // Object index  2
    "d": { "x": 0 }, // Object index  3
    "e": { "x": 0 }, // Object index  4
    "f": { "x": 0 }, // Object index  5
    "g": { "x": 0 }, // Object index  6
    "h": { "x": 0 }, // Object index  7
    "i": { "x": 0 }, // Object index  8
    "j": { "x": 0 }, // Object index  9
    "k": { "x": 0 }, // Object index 10
    "l": { "x": 0 }, // Object index 11
    "m": { "x": 0 }, // Object index 12
    "n": { "x": 0 }, // Object index 13
    "o": { "x": 0 }, // Object index 14
    "p": { "x": 0 }, // Object index 15
  },
  // continues ...
];
```

Now mapping over eg. properties of all of the `a` objects would indeed be 16
indexes or more apart from one another, and this sort of reduce algorithm would
give us our worst case scenario:

```js
arr.reduce((acc, collection) => acc + collection.a.x, 0);
```

For each `collection.a.x` accessed, this would first read 3 cache lines to get
the `collection` object's `ObjectHeapData` (and one more for the `caps` data;
this gets shared between 4 following object accesses), and then 1 cache line to
read the `a` property from it. Then it would read 3 cache lines to get the `a`
Object data, and 1 cache line for the `x` property. On the second round the
`collection` data would once again be loaded from a different cache line which
means a memory stall (its `a` object is actually on the same cache line as the
previous `collection` item was; we can double the number of objects in the
`collection` object and access one of the object "in the middle" to ensure that
all accesses are never share cache lines with any previous one). This gives us
our absolute worst case scenario, where each object property access requires 4
cache line reads, for a total of 8 cache lines read for each `x` property
accessed.

How would V8 fare in this case? In V8, the `collection` objects are 152 bytes in
size, as all of their properties are contained in-line in the object. To read
the `a` property we need to access the `map` pointer and the `a` field, which in
the written case is on the same cache line as `map` (if we were reading a
proprety not at the start of the object, this would require a second cache line
read). The `x` property is then again in-line in the `Data` object and accessing
it requires also accessing the `map` pointer, both of which we get to do with a
single cache line read. This then comes out to a total of just 2 cache line
reads per `x` property accessed, which is basically what we want to see: We
access two fields, we read two cache lines.

From a memory latency point of view, for V8 this is 2 cache line reads and 2
memory stalls. For Nova, this is 8 cache line reads and 4 memory stalls.
Quadupling the number of cache line reads means we evict 4 times more cache
lines which is of course not good, but at least we "only" doubled the number of
memory stalls instead of quadrupling them.

The question is, would Nova gain anything from splitting the object data apart
like this? One thing that definitely is gained is a reduction in memory usage
through removal of padding: We save 3 bytes per object, roughly 20%, in padding
space with the splitting of the `cap` property. Another thing we gain is that
prototype access only requires accessing the `Shape` value, but this is hardly a
thing to be proud of: I have never seen a loop over objects calling
`Object.getPrototypeOf(item)`.

The only access of an object that really matters is the property access, and
property access requires accessing the shape, properties, and capacity _at the
very least_. Potentially, the shape of an object could indicate its properties
length as well in which case accessing the `len` could be avoided in some
circumstances, but that would be risky. No, it does seem that all of `cap`,
`len`, `shape` and `properties` values are needed. There is an actual benefit to
separating `cap` from the rest (the three padding bytes mentioned before).
Another meaningless benefit to `Object.getPrototypeOf(item)` can be realised by
splitting `shape` apart. So it would seem like we should split `cap` apart and
leave `len`, `shape`, and `properties` together.

However, we have yet to consider garbage collection. In garbage collection it
actually helps a lot if the fields are split apart from: The kind of transform
that needs to be done for each depends generally on only the field itself
(although `properties` needs `cap` for its transform selection), making
split-apart fields a prime candidate for SIMD transforms.
