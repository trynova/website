---
title: Building a TypedArray
description: A play-by-play view into implementing TypedArray in Nova.
date: 2024-10-05
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

It is time for some "live coding" in the form of a blog post. This will serve as
a window into both the Nova engine's internals and how data-oriented design
informs it. Strap on, we're going to implement TypedArrays (or at least one type
of them)!

## What is a TypedArray?

In order to implement a TypedArray, we obviously need to know what it is. The
ECMAScript specification gives us a fairly good
[explanation](https://tc39.es/ecma262/#sec-typedarray-exotic-objects) on what
TypedArrays are in the abstract sense and
[how to create them](https://tc39.es/ecma262/#sec-typedarraycreate). These serve
as a good starting point of what we _have to do_ but they do not much explain
what we should actually do.

If we think back to [the previous blog post](./internals-of-nova-part-2.md), I
quoted Mike Acton's excellent [CppCon talk](todo) on data-oriented design and a
lot of that centered around knowing the data you work with and how you should
design based on real data (if you can get it) and for a real piece of hardware.
As we're not the first to implement TypedArrays we actually have that real data
and can design based on it.

A TypedArray such as a `Uint8Array` is a view into a raw contiguous memory
buffer, an `ArrayBuffer` in JavaScript terminology. The TypedArray's type
defines the bit width and alignment of an individual element in the view
"Array", and allows both reading and writing to said elements. Additionally,
querying the byte length of the view and its offset compared to the origin of
the `ArrayBuffer` is made possible. Finally, accessing the original
`ArrayBuffer` is also possible.

The `ArrayBuffer` offers a few other interesting APIs: It may be resizable which
allows the buffer to grow or shrink, and it may be detached which makes its
backing data inaccessible. A TypedArray must account for these changes, meaning
that if the ArrayBuffer is suddenly detached then the TypedArray must become a
zero-sized view and likewise if the ArrayBuffer is resized then the TypedArray
must (temporarily) shrink in kind. It is worth noting that resizing may be
implemented as a reallocation. These cases must be checked, lest the engine ends
up invoking nasal demons through undefined behaviour (use-after-free for
resizing, data race for detaching).

### First draft: A rough block

Despite the possibility, in the common case an ArrayBuffer is neither detached
not resized. It thus stands to reason that a TypedArray can first and foremost
be thought of as a pointer to a memory allocation at an offset and length
associated with it. Still, we need the `ArrayBuffer` reference in there as well.
Our first draft for a TypedArray's data is thus:

```rs
struct TypedArrayHeapData {
    ptr: *mut u8,
    offset: usize,
    length: usize,
    /// u32 reference to ArrayBuffer
    buffer: ArrayBuffer,
}
```

We must also support the Object features of TypedArrays, so we'll put those in a
separate hash map on the side behind a "backing object" reference
([see Internals of Nova part 1](./internals-of-nova-part-1.md)) and store our
`TypedArrayHeapData` in a vector
([see Internals of Nova part 2](./internals-of-nova-part-2.md) for more on heap
vectors):

```rs
#[repr(transparent)]
struct TypedArray(NonZeroU32);

struct TypedArrayVec {
    ptr: *mut TypedArrayHeapData,
    // Note: We index the TypedArrayVec using a u32 'TypedArray'; a 'usize'
    // length would be unnecessarily large.
    len: u32,
    cap: u32,
    backing_object: Map<TypedArray, OrdinaryObject>,
}
```

There's just one, maybe two problems with this: The first one is that we have
many types of TypedArrays and this data doesn't tell us what our type is, but
we'll ignore that for now. The second and bigger problem is that our
`TypedArrayHeapData` is a massive 32 bytes in size with 4 bytes of padding in
there as well. This is not an acceptable size for a type intended to be as
light-weight and nimble as possible.

### Second draft: Rounding the corners

You might look at the struct and think that there is nothing anyone can do about
its size. This is the size that it has to be to support the features it has.
Theoretically you'd be right, but we have the context of real-world usage data
and that we store the `TypedArrayHeapData` structs in a vector. The first idea
that comes to mind is that TypedArrays often have an offset of 0: We could move
`offset` into a separate hash map side-table and thus avoid allocating any
memory for those cases. This may indeed be a worthwhile effort, but an in-depth
analysis would be needed to really decide on that. There are also points against
it: The best kind of TypedArray is often one where the internal buffer is shared
between multiple views so that the number of separate allocations is minimized,
and in those cases all but one TypedArrays have non-zero offsets. We'll put this
on the back-burner.

But! Most TypedArrays are definitely not 4 gigabytes in size. They are usually
some kilobytes or megabytes at most. Having to use full 64-bit `usize` values to
store the length and offset will nearly always waste the upper 4 bytes of both.
The specification even requires that the maximum length of a TypedArray is a
53-bit integer, so we know that a full byte and one bit of the `usize` is always
wasted.

What we can do instead is turn the length and offset into 32-bit integers and
use their maximum value as a sentinel to say that the value must be read from a
side-table. Or we can use the top bit to signal that the upper 22 bits of our
53-bit integers are found in the side-table. Either method gives us something
like this:

```rs
struct TypedArrayHeapData {
    ptr: *mut u8,
    offset: u32,
    length: u32,
    /// u32 reference to ArrayBuffer
    buffer: ArrayBuffer,
}
```

Now our TypedArray is only 24 bytes in size, but 4 bytes of that is still
padding. Nothing is worse than padding, as it guarantees wasted bytes.

### Third draft: Filing the edges

I can see no immediate, great solution to our padding problem. We can start
splitting parts off of the TypedArrayHeapData and there would be some upsides to
that: Spitting off the length would allow `ta.byteLength` and `ta.length`
property getters to avoid loading `offset` and `ptr` but only if `buffer` was
split off as well. Splitting off `buffer` would allow for our tracing garbage
collector to perform TypedArray tracing without loading in the pointer related
data. But excessive splitting is not necessarily a good thing either: More
splitting means we load cache lines up front, and if we end up not using the
adjacent data then we've wasted more cache space than what our first split-less
implementation would've.

With some more thought, three options worth pursuing appear: First, we could
remove the `ptr` entirely. As it is not safe to read data from an
`ArrayBuffer`'s backing buffer without checking the detached status and size of
the `ArrayBuffer`, caching the `ptr` only enables us to manually prefetch the
buffer memory. Second, we could move `offset` onto a separate cache line and
calculate it into our cached `ptr`. Third, we could look into V8's external
pointer table for guidance and decide that the `ptr` shouldn't be present in the
`TypedArrayHeapData` at all but should be replaced with a `u32` reference to a
`Vec<ExternalPointer>` index where the real pointer is stored with a bitmask
applied on it for safety.

The third option would make a lot of sense, but at the present moment Nova does
not have an external pointer table. The heap's ability to defend against heap
corruption attacks is not a strong priority either as all heap accesses are
already strongly guarded and heap corruption should be very unlikely to be a
viable attack strategy. As such, for now the second option seems like the better
option.

Our final plan looks like this:

```rs
#[repr(C)]
struct TypedArrayHeapData<const N: usize> {
    access_datas: [TypedArrayAccessData; N],
    byte_offsets: [TypedArrayByteOffset; N],
}

struct TypedArrayAccessData {}
    offset_ptr: *mut u8,
    length: u32,
    /// u32 reference to ArrayBuffer
    buffer: ArrayBuffer,
}

#[repr(transparent)]
struct TypedArrayByteOffset {
    offset: usize,
}

struct TypedArrayVec {
    // Note: Invalid Rust, 'cap' cannot be referred to as a const generic. This
    // is only to show the idea.
    ptr: *mut TypedArrayHeapData<cap>,
    len: u32,
    cap: u32,
    // Any TypedArray with length greater or equal to u32::MAX keeps its length
    // value here instead.
    large_lengths: Map<TypedArray, usize>,
    backing_objects: Map<TypedArray, OrdinaryObject>,
}
```

Now in the common case of reading or writing a specific index or indexes in a
TypedArray we need to only read that TypedArray's `TypedArrayAccessData`, fetch
the backing `ArrayBuffer`'s data to check that it is not detached and to compare
that both `offset_ptr` and `offset_ptr + length` are within the buffer's
allocation. If `length == u32::MAX` then we are guaranteed to find an entry in
the `large_lengths` hash map for this TypedArray. Our `TypedArrayAccessData` is
only 16 bytes in size, and the combined heap data size of a single TypedArray
is just 24 bytes.

Comparing this to a whopping 96 bytes in Node.js and 80 bytes in Chromium, I think we
can safely say that this likely to be a worthwhile optimisation.
