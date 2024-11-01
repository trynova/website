---
title: Data-oriented View
description: Improving the JavaScript DataView builtin with data-oriented design.
date: 2024-11-01
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
  - name: Elias Sjögreen
    url: https://github.com/eliassjogreen
---

The ECMAScript specification contains many purpose-built exotic objects that
have very limited and very specific usages. One of them is the `DataView`
builtin constructor which is meant for mixed-size reads and writes into the
binary data contained in an `ArrayBuffer`. Recently, Nova has been added the
`ArrayBuffer` constructor and now it is time to add `DataView` to enable useful
interaction with them.

But what should our `DataView` look like? Remember that we use the
[backing object trick](./internals-of-nova-part-1.md) to separate object
features from the special exotic object usages. That is where we should start.

## Learning from giants

The V8 engine is hard to beat in its performance. If you bust out your trusty
Node.js version v23.1.0 and run the following command

```sh
node --allow-natives-syntax -e "%DebugPrint(new DataView(new ArrayBuffer(0)))"
```

you'll get the following output:

```console
DebugPrint: 0x3baa678e2f79: [JSDataView]
 - map: 0x055226f42251 <Map[88](HOLEY_ELEMENTS)> [FastProperties]
 - prototype: 0x055226f42679 <Object map = 0x55226f42299>
 - elements: 0x2b19b4bc0d09 <FixedArray[0]> [HOLEY_ELEMENTS]
 - embedder fields: 2
 - buffer =0x3baa678e2f19 <ArrayBuffer map = 0x176c86f02d19>
 - byte_offset: 0
 - byte_length: 0
 - properties: 0x2b19b4bc0d09 <FixedArray[0]>
 - All own properties (excluding elements): {}
 - embedder fields = {
    0, aligned pointer: 0
    0, aligned pointer: 0
 }
0x55226f42251: [Map] in OldSpace
 - map: 0x176c86f00079 <MetaMap (0x176c86f00109 <NativeContext[299]>)>
 - type: JS_DATA_VIEW_TYPE
 - instance size: 88
 - inobject properties: 0
 - unused property fields: 0
 - elements kind: HOLEY_ELEMENTS
 - enum length: invalid
 - stable_map
 - back pointer: 0x2b19b4bc0069 <undefined>
 - prototype_validity cell: 0x2b19b4bc12d9 <Cell value= 1>
 - instance descriptors (own) #0: 0x2b19b4bc0d69 <DescriptorArray[0]>
 - prototype: 0x055226f42679 <Object map = 0x55226f42299>
 - constructor: 0x055226f421e9 <JSFunction DataView (sfi = 0x2b19b4bd0999)>
 - dependent code: 0x2b19b4bc0d29 <Other heap object (WEAK_ARRAY_LIST_TYPE)>
 - construction counter: 0
```

The debug output is lying a little (the `prototype` field does not exist on the
object instance but is inside the `map`), but we can see a bunch of interesting
things there. The `buffer` is there which makes sense, we need to know which
`ArrayBuffer` we're viewing after all. But we also have two embedder fields that
seem to be unused, and naturally we have the byte length and offset; those can
be defined as constructor parameters for the `DataView`.

The less interesting things we see is the `map`, `properties`, and `elements`
pointers, and the worst thing by far is the end result: `instance size: 88`.
That is 88 bytes for what is, arguably, just a pointer and a length. The worst
offenders here are probably the embedder fields, though I am incapable of
figuring out how the full instance size can be as big as it is, no matter how I
sum up field sizes together.

If we open up a recent Chromium browser and use the memory snapshot feature to
inspect the size of a `DataView` instance, we can see that it is only 48 bytes.
This significant reduction is achieved by a double-whammy of pointer compression
which drops intra-heap pointer sizes to just 4 bytes a piece (this makes `map`,
`properties`, `elements`, and `buffer` take half the size) and a
[recently merged change to V8](https://issues.chromium.org/issues/346350847)
that removed the need to keep embedder slots in `DataView` instances. Even with
these improvements, 48 bytes is 3 times the optimal memory usage for a pointer
and length that we'd like to see.

For Nova, we can drop a good bit of this extra memory with our backing object
trick. This is what that looks like:

```rs
struct DataViewHeapData {
    backing_object: Option<OrdinaryObject>,
    buffer: ArrayBuffer,
    byte_offset: usize,
    byte_length: usize,
}
```

This is 24 bytes in size; we've halved V8's post-optimization memory usage and
are within spitting distance of the optimal memory usage. You might remember
from earlier that with Realm-specific heaps we can drop the
`Option<OrdinaryObject>` by moving it into a hash map based side-table which we
can expect to be mostly empty since `DataView` objects are very unlikely to have
any properties assigned to them or to have their prototype changed. In this case
that removal wouldn't do us any good though, as the 4 bytes freed would just
become padding.

So, that's it right? We've got as close to perfection as we can, and there is
nothing more we can do. It's obviously impossible to improve on this.

## Becoming David

What if I told you we can get our `DataView` object's size down to 12 bytes for
the common case: Would you believe me? Maybe you would. What if I told you we
can get it down to just 4 bytes: That should be blatantly impossible, right? But
to fight giants, you must become impossibly small!

### A dozen, no more!

To get down to 12 bytes in size, we'll have to take a data-oriented leap of
logic: `DataView` is used to view into an `ArrayBuffer`, and it is uncommon that
an `ArrayBuffer` is larger than 4 gigabytes in size. Hence, the byte offset and
length of the `DataView` are unlikely to need the full 8 bytes of data and we
can instead use just a 4 byte unsigned integer as their value.

If we indeed do need the full 8 bytes, then we'll store those in a hash map
based side-table, just like the backing object. We only need to reserve a single
sentinel value in the 4 byte offset and length values that tells us to look in
the side-table for the uncommon large byte offset or length.

With this, we are down to 16 bytes with an alignment of 4 bytes and now we can
kick the backing object out of the `DataViewHeapData` struct into a separate
side-table and actually gain the 4 byte benefit.

```rs
struct DataViewHeapData {
    buffer: ArrayBuffer,
    // u32::MAX if data lives in side-table
    small_byte_offset: u32,
    // u32::MAX if data lives in side-table
    small_byte_length: u32,
}
```

Now we're 12 bytes in size; we're 25% smaller than the optimal case (though we
have an extra indirection compared to the optimal case, this is effectively
required by the ECMAScript specification). But we're not really impossibly small
yet. We have more shrinking that we can do!

### The Elite Four

Think back to the V8 debug print from earlier: We used a `DataView` to view the
entirety of an `ArrayBuffer`. If we assume that most `DataView` construction
cases are one of

```ts
new DataView(arrayBuffer);
new DataView(arrayBuffer, 0);
new DataView(arrayBuffer, 0, arrayBuffer.byteLength);
```

then the following points will usually be true:

- A `DataView`'s `[[ByteOffset]]` is 0.
- A `DataView`'s `[[ByteLength]]` is equal to the its `[[ViewedArrayBuffer]]`'s
  `[[ArrayBufferByteLength]]`.

So, here's a thing we could do: We could opt to never store the `byte_offset`
and `byte_length` fields in our `DataViewHeapData` struct. Only if those have
non-default values will we'll store them in the side-tables. When we access a
`DataView`'s data, we'll then have to check if those side-tables contain data for us:
The optimal case is that the tables turn out to be entirely empty in which case
we do not even need to perform a hashing of our `DataView`, or look inside the
side-table.

So this is what we end up with:

```rs
struct DataViewHeapData(ArrayBuffer);
```

That is only 4 bytes: Four elite bytes. We are now 4 times more memory-compact
than the "optimal case", and 12 times better than V8 with pointer compression on.
Unfortunately this is a very fiddly optimisation that may not make sense in
the end: If any `DataView` has a non-default byte offset or length value, it
forces all `DataView`s to perform a hash map lookup (or two) to check their offset
and length values. This hashing also needs to be performed on every API call, even
if those calls happen in a tight loop.

Additionally, the hash map lookup costs not only a hash calculation but it also
has to perform at least one cache line read to look for our calculated hash in the side-table.
So our attempt to reduce the size of `DataView`s to save on cache line reads
actually lead us to likely add an extra cache line read. And,
`DataView` is also an unlikely object type to appear in very tight loops where
we're iterating over multiple `DataView`s so the ability to read 16
`DataViewHeapData` structs in a single cache line is unlikely to give us much
concrete benefits.

## Growing up, taking stock

So [this](https://github.com/trynova/nova/pull/447) is where we are: We have a
way to make `DataView` take only 4 bytes but we think it probably does not make
sense and instead we're going with the 12 byte version. This increases to 16 bytes
because we currently do not have Realm-specific heaps and thus need the
`backing_object` in the `DataViewHeapData` struct. (Never mind that we do not
actually have a proper multi-Realm heap working either and with the current,
incomplete system we could fully well use a hash map side-table for backing
objects: These things take time you know.)

The 12 byte version should give us a good balance between memory usage and easy
memory access patterns, at the same time avoiding storing data that is nearly always
statically zero and avoiding introducing a performance cliff on the supposed happy path
from hash map calculations if even a single non-default `DataView` exists in the
runtime.

The Nova JavaScript engine is built upon data-oriented design, which points us
towards opportunities that may seem improbable or even impossible in a
traditional engine design. However, finding new opportunities does not mean that
every single one is a good one. We have to know our data and design around it so
that we can reason about the costs of the different solutions. At the end of the
day, reason must prevail: If it seems like the cost of our new solution is
larger than the old one, it must be rejected. (Barring more data showing the new
solution to be more cost-effective after all.)

This is our data-oriented view.
