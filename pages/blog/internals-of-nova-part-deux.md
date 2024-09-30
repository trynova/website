---
title: Internals of Nova Part 2 - Rows for the Row God, Columns for the Column Throne!
description: Looking at more of the secret sauce that makes Nova.
date: 2024-09-14
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

[Last time](./internals-of-nova-part-1.md) I talked about how non-ordinary objects in Nova delegate their object features to a "backing object". This allows "exotic objects" to focus on the features that they are meant for and not get bogged down in the details that is JavaScript objects. This saves us some memory on every exotic object, but there is nothing particularly amazing about this trick. Any old engine could do the same thing and reap the same benefits.

This time I will delve into the foremost idea behind Nova's heap structure; this idea is also what has driven me to dedicate my time to Nova. The name of this idea is the "heap vector", an idea inspired by the [entity component system](https://en.wikipedia.org/wiki/Entity_component_system) and [data-oriented design](https://en.wikipedia.org/wiki/Data-oriented_design) in general.

I will also skip to the punchline first and come back for the reasons later. So buckle in and prepare yourself, this might sting a little before it gets better. I promise you, it will feel good in the end.

## Storing things in vectors, the old fashioned way!

Nova's heap is built around vectors. We do not have any fancy half-space copying garbage collectors, or interesting tombstones for relocations. We have but a bunch of vectors that are managed quite plainly and simply. Each kind of heap data, be it a Symbol, String, Number, ordinary Object, Array, Map, Set, ..., each has its data saved in its own "heap vector". A JavaScript Value in Nova is then a type tag which tells which heap vector to access, and an index into the vector. Everything else flows from there.

Let us go for a stroll.

### Array heap data

First we look at my favourite exotic object in all of JavaScript: The humble Array. The way I want to store the data for all Arrays alive in the heap is this:

```rs
/// One-based index into ArrayVec
///
/// Note: NonZeroU32 is used to make None<Array> the same size as Array.
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
    // Note: Invalid Rust, 'cap' cannot be referred to as const generic. This is only to show the idea.
    ptr: *mut ArrayHeapData<cap>,
    // Note: Use u32's as we index using u32; usize would be unnecessarily large.
    len: u32,
    cap: u32,
    backing_objects: HashMap<Array, OrdinaryObject>,
}
```

Our Array "heap vector" is a pointer to three "parallel" slices of data of `ElementIndex` (a `u32`), `u32`, and `ElementCapacityWritability` (a `u8`). (For the #dark-arts folks out there: Yes, these should actually be `MaybeUninit<T>` for each slice. I'm saving keystrokes.) A single Array owns one index from each slice, meaning that effectively an Array's static data is made up of `(ElementIndex, u32, ElementCapacityWritability)`, which is 9 bytes in total (we get to ignore padding because of the homogenous slices).

Additionally, we keep a `backing_objects` HashMap on the side. The purpose for this is to act as something of a scratch memory for those Arrays that make use of their object properties. That is, Arrays that have named properties set on them or that have prototypes that differ from `Array.prototype`. The absolute majority of Arrays do not have these and thus we avoid the need to allocate any memory for them in this way. This does assume that we can know the proper Realm in which the Array was created in, but if we have a separate Heap for each Realm then this is trivially knowable. Firefox's SpiderMonkey has precisely this sort of setup, so we can probably follow their lead on this without much issue.

This is unfortunately not reality yet. Currently Nova's Array heap vector looks like this:

```rs
struct ArrayHeapData {
    /// u32 index to Vec<ObjectHeapData> or 0 for None
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

type ArrayHeapVector = Vec<ArrayHeapData>;
```

Each Array again owns one index in the `ArrayHeapVector` but the Array's data is all held together. This is somewhat simpler to reason about and much easier write out in code than the slice-based one up above. That being said, this is also likely to have worse performance: This struct's size is larger because of padding bytes and the backing object index held within.

### Object heap data

In the same vein, what I want our Objects to look like is this:

```rs
struct ObjectHeapData<const N: usize> {
    /// a u32 index to Vec<Shape>
    shapes: [Shape; N],
    /// a u32 index to Vec<PropertiesHeapData<cap>>
    properties: [PropertiesIndex; N],
    /// number of properties currently used
    lens: [u32; N],
    /// 
    caps: [PropertiesCapacityExtensibility; N],
}
struct ObjectVec {
    ptr: *mut ObjectHeapData<cap>,
    len: u32,
    cap: u32,
}
```

Each Object owns one index of the `ObjectHeapData` slices, so each Object has a `Shape` (a `u32`), a `PropertiesIndex` (a `u32`), a length `u32`, and `PropertiesCapacityExtensibility` (a `u8`). That makes a total of 13 bytes. The `Shape` value is an index to a heap vector of Shapes, also known as [hidden classes or Maps](https://v8.dev/docs/hidden-classes). These are data structures that describe the shape of an object, ie. its prototype and keys. They help reduce memory usage of objects by deduplicating the repetitive parts, and they make caching of prototype property access (such as class method accessing) possible. Nova does not currently have Shapes, but they are an absolute necessity for any JavaScript engine that hopes to have good performance under real-world workloads.

And as with Arrays, Nova's Objects are currently not yet split into slices like this and it is quite a bit less clear if it makes sense to split all of the fields apart like this. Still, I mean to try it out. If it shows even equivalent performance it may be worth the switch, as this split format is likely to give outsized benefits for our garbage collection algorithm.

## Rows for the Row God, Columns for the Column Throne!

Yes! That is what I want! As long as performance measurements show improved or roughly equal performance (taking into account garbage collection performance as well), rows and columns is what I want to do. The more the merrier!

"But why?", you ask. Well, let me tell you: The reason is cache efficiency and memory savings. Every pointer we replace with an index saves us 4 bytes. Every pointer that we entirely eliminate from the common case saves us 8 bytes. In Node.js, an Array is 32 bytes and so is the smallest Object. With the planned heap structure of Nova, we can fit 3.5 Arrays in that same space, or about 2.5 Objects. Even with V8's pointer compression (in use in Chromium) Nova would use 20-40% less memory per Array or Object.

Saving the heap data in separate slices means that iterating over large quantities of Arrays or Objects to access parts of them loads into the CPU cahce only those parts that are truly needed. The parts that are not needed do not get loaded "on the side", and do not pollute the CPU cache. Instead what gets loaded is other "nearby" Array's or Object's equivalent parts; these are the most likely thing you'll be accessing next during your iteration and hence loading them in is a blessing, not a curse.

## Data-oriented design

We finally come to the elephant in the room. Nova titles itself as a "data-oriented JavaScript engine" or as "following data-oriented design principles". But what does that even mean? And how is that connected with more rows and columns?

Data-oriented design as meant by [Mike Acton in 2014](https://www.youtube.com/watch?v=rX0ItVEVjHc) (terrific talk by the way, watch it every night before bed) is boiled down to the following points:

1. As a matter of fact, the purpose of all programs and all parts of those programs is to transform data from one form to another.
2. If you don't understand the data you don't understand the problem.
3. Conversely, you understand the problem better by understanding the data.
4. Different problems require different solutions.
5. If you have different data, you have a different problem.
6. If you don't understand the cost of solving the problem, you don't understand the problem.
7. If you don't understand the hardware, you can't reason about the cost of solving the problem.

He also gives the following rules of thumb for thinking in terms he finds important or useful:

1. Where there is one, there are many. Try looking on the time axis.
2. The more context you have, the better you can make the solution. Don't throw away data you need.
3. 