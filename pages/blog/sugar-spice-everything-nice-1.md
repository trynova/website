---
title: Sugar, spice, and everything nice... Part 1
description: Looking at the secret sauce that makes Nova.
date: 2024-08-13
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

In the [Why build a JavaScript engine?](./why-build-a-js-engine.md) blog post I
mentioned that "we do have an idea, a new spin on the ECMAScript specification."
It is time to talk about that idea, or actually the first idea of many. This is
the idea of the "backing object".

## What makes an object?

The [ECMAScript specification](https://tc39.es/ecma262/) defines two main types
of objects: The [ordinary objects](https://tc39.es/ecma262/#sec-ordinary-object)
and [exotic objects](https://tc39.es/ecma262/#sec-exotic-object). An ordinary
object is defined as an "object that has the default behaviour for the essential
internal methods that must be supported by all objects". Any object that is not
an ordinary object, meaning that it has one or more non-default behaviours for
their internal methods, is thus an exotic object.

These definitions may not tell you much if you've never delved into the
ECMAScript specification too deeply. When you run your average JavaScript code,
you deal in both ordinary and exotic objects. Here are some examples:

```js
const obj = {}; // an ordinary object
const func = () => {}; // an ordinary object
const func2 = func.bind(null); // an exotic object
const arr = []; // an exotic object
const map = new Map(); // an ordinary object
const ab = new ArrayBuffer(); // an ordinary object
const ta = new Uint8Array(); // an exotic object
const dv = new DataView(); // an ordinary object
```

This seems to be rather confusing: Why is `Uint8Array` an exotic object but the
`ArrayBuffer` "within" it is ordinary? And, if an `ArrayBuffer` is "ordinary"
then how can it contain the memory buffer for typed arrays to use but `{}`
cannot? To solve this mystery, we must introduce the concept of "internal
slots". All ordinary objects have `[[Prototype]]` and `[[Extensible]]` slots.
The first defines what the object's current prototype is (accessible using
[`Object.getPrototypeOf(obj)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/getPrototypeOf)),
and the second defines if the object accepts new properties (accessible using
[`Object.isExtensible(obj)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/isExtensible)).

Some objects have additional internal slots. Let's take a look at the above
examples but now mark those extra internal slots as well.

```js
const obj = {}; // an ordinary object
const func = () => {}; // an ordinary object, extra internal slots
const func2 = func.bind(null); // an exotic object, extra internal slots
const arr = []; // an exotic object, extra internal slots
const map = new Map(); // an ordinary object, extra internal slots
const ab = new ArrayBuffer(); // an ordinary object, extra internal slots
const ta = new Uint8Array(); // an exotic object, extra internal slots
const dv = new DataView(); // an ordinary object, extra internal slots
```

This starts to make more sense from an intuitive sense: Plain JavaScript objects
are ordinary objects with no extra internal slots. All other objects are either
exotic or have some extra internal slots; we can lump these together as "sort of
exotic objects" if you will. For these "sort of exotic objects", their extra
internal slots are what gives them their awesome powers: It's their sugar,
spice, and everything nice!

## What's that objéct?

We now understand that plain objects are separated from all more "interesting"
types of objects at the specification level by their differing internal methods
(remember, exotic objects have non-default internal method behaviours) and/or
internal slots.

With this basic idea in mind, let's play a little guessing game: You are an
ECMAScript engine, and your job is to evaluate the first few steps of the
following expressions. Try to think, what is it that you are looking for in each
object: Is it an object property you need, or are you looking for something that
is hidden from JavaScript code (that is, an internal slot)?

### Slihouette #1

Let's start off small, just a function call:

```js
func();
```

Now what do you, the engine, do first? Yes, correct! First you need to check
that `func` is callable. At a JavaScript programmer level this could be done
with `typeof func === "function"` but the engine has an internal way to check:
It is the presence of the `[[Call]]` internal method on the object.

The next step would be to go find the function's source code and start executing
that. (There are some setup steps but let's not get bogged down in the details.)
Again from a JavaScript programmer's perspective you might know that you can get
a function's source text using `func.toString()` but that is of course not what
an engine does directly, and the `toString` function is not a property on the
`func` object but on the `Function.prototype` object. That function must somehow
be accessing the necessary information through the `this` parameter of the
`toString` call, that is from the `func` object.

That information cannot be accessed from the `func` object within JavaScript.
Thus we must conclude that the data must be held in some internal slot.
Functions usually only have `length` and `name` properties, and even those can
be deleted without affecting the functionality of the function object. Calling a
function clearly does not rely on the object features of the function.

### Silhouette #2

We'll continue with simple things, this time an `ArrayBuffer` being used as a
parameter for a `Uint8Array` construction:

```js
new Uint8Array(ab);
```

What do you, as an engine, do first? Yes, you check that the parameter is indeed
an `ArrayBuffer` (let's ignore other parameter types). But how? You could check
the prototype of `ab` but that is not guaranteed to be anything you expect: You
can set the prototype of an `ArrayBuffer` to `null` and it will still work as a
parameter to a TypedArray constructor as normal. If you look at `ab`'s property
descriptors using
[`Object.getOwnPropertyDescriptors(ab)`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/getOwnPropertyDescriptors)
you will find there are none.

Yet an engine still knows an `ArrayBuffer` to be an `ArrayBuffer`: This must
again be based on internal slots. The most important thing that makes an
`ArrayBuffer` has nothing to do with its prototype or properties, but only with
its internal slots.

### Silhouette #3

Now it's time to rumble! Let's look at indexing into an `Array`:

```js
arr[0];
```

Now, we're finally on traditional footing here. This is object property access
plain and simple, right? You could have `arr` be an `Array` or a plain object
and the code and the behaviour would be one and the same, right? From a
specification standpoint you would be exactly correct, but: From a usage
standpoint, the purpose of an `Array` is to act as a linear, access-by-index
collection of values. An object's purpose is to act as something less defined,
an acces-by-name collection of values.

Most if not perhaps all production engines out in the world make no difference
between an object and an `Array` (except for the specification mandated handling
of the `length` property). Both can hold indexed properties and named
properties, and both store properties in the same way: Indexed properties go
into an "elements" storage, and named properties go into a "properties" storage.

But now consider the indexing into an `Array` and forget that objects already
have an "elements" storage in V8 and SpiderMonkey. Accessing the 0'th index in
an `Array` does not depend on the properties of the `Array`, nor does it depend
on the prototype of the `Array` (unless there is no 0'th entry). The `length` of
an `Array` also tells us immediately if we are within the possible range of
entries, or if we are accessing outside the bounds of the `Array`. Again we find
that from a concrete usage standpoint, an `Array` does not depend on its object
features.

## What did we learn, reader?

We took a stroll through the underbrush that is objects in ECMAScript and how
they are normally used. Now that we are on the other side, it may look like a
bit of a clusterfuck. But here's what I want you to take out of this: Ordinary,
plain objects are ordinary and plain. Everything beyond that is first and
foremost defined by its internal slots, and sometimes by its internal methods or
common usage.

This finally brings me to the concept of a "backing object". An `ArrayBuffer` is
first and foremost the byte buffer it carries within it. The ECMAScript
specification would have you believe that your `ArrayBuffer` should look like
this:

```rs
struct ArrayBuffer {
    /// [[Prototype]]
    prototype: ObjectOrNull,
    /// [[Extensible]]
    extensible: bool,
    /// Object property storage
    properties: Properties,
    /// [[ArrayBufferData]]
    data: ArrayBufferData,
    /// [[ArrayBufferByteLength]]
    byte_length: usize,
    /// [[ArrayBufferDetachKey]]
    detach_key: Any,
}
```

You can then clean this up by putting the "common parts" into a `ObjectBase`
struct that you share between all special object types. This seems entirely
reasonable but there's a problem: The first half of the `ArrayBuffer` is
meaningless fluff! The prototype is not needed for the `ArrayBuffer` to
function! Its extensibility is basically of no concern! And assigning properties
is likewise very rarely if ever done!

What we've done here is waste a ton of good memory for something that ough to
have been one of the more efficient and performant building blocks in the
ECMAScript specification. As a concrete example, an empty `ArrayBuffer` in
Node.js takes 80 bytes (with pointer compression it's probably quite a bit
less). If we assume that the data is a raw pointer and that the `detach_key` is
one likewise, the actual `ArrayBuffer` parts take up 24 bytes (32 bytes if we
account for growable ArrayBuffers, which V8 does). More than half the object
size is taken up by things that are never used.

What can we do to improve this? Let's get rid of the fluff! Here is what we'll
do: We rip out the `ObjectBase` and put it on the side somewhere. Then, we use
some pointer-tagging magic to get a two-variant pointer crammed into a single
pointer-sized slot. These variants will be the `ObjectBase` pointer variant and
the `Realm` pointer variants. Our `ArrayBuffer` struct then becomes this:

```rs
struct ArrayBuffer {
    /// "[[BackingObject]]"
    backing_object: ObjectBaseOrRealm,
    /// [[ArrayBufferData]]
    data: ArrayBufferData,
    /// [[ArrayBufferByteLength]]
    byte_length: usize,
    /// [[ArrayBufferDetachKey]]
    detach_key: Any,
}
```

Suddenly that looks a lot nicer. The `backing_object` is now a tagged pointer
that either points to an `ObjectBase` struct, or it points to an ECMAScript
`Realm`. The size of the entire struct is now only 32 bytes. It grows to 40 if
we support growable buffers with the same struct.

Now for how this works. Initially, when a new `ArrayBuffer` is created, the
`backing_object` points to the `Realm` that created it. Later, if a property is
assigned into the `ArrayBuffer` object or its prototype is changed from the
default `%ArrayBuffer.prototype%` (of the pointed-to `Realm`), a new
`ObjectBase` is allocated (in the proper `Realm`) and the `backing_object`
pointer is set to point to that struct.

But: No one does that, for the absolute most part. And if they do, they are
likely using those additional properties or changed prototype only rarely. They
are probably using the `ArrayBuffer`'s object features because it is convenient
to be able to treat it as an object _in addition to_ it being an `ArrayBuffer`,
not for purely the object features themselves. Those extra properties are still
a secondary concern to the actual `ArrayBuffer` usage, for if it were not then
they would have used a plain object.

So, this is what we do: For every exotic object and for every object with
additional internal slots we replace the ordinary object internal slots and
property storage with a `ObjectBaseOrRealm` pointer. Let's take a look at some
examples.

Here's what an Array looks like after this transformation:

```rs
struct Array {
    /// "[[BackingObject]]"
    backing_object: ObjectBaseOrRealm,
    /// Pointer to the elements backing store
    elements: Elements,
    /// Length of the Array
    length: u32,
}
```

And this is what a TypedArray like `Uint8Array` looks like:

```rs
struct TypedArray {
    /// "[[BackingObject]]"
    backing_object: ObjectBaseOrRealm,
    /// [[ViewedArrayBuffer]]
    viewed_array_buffer: ArrayBufferPointer,
    /// [[TypedArrayName]]
    typed_array_name: StringPointer,
    /// [[ContentType]]
    content_type: TypedArrayContentType,
    /// [[ByteLength]]
    byte_length: usize,
    /// [[ByteOffset]]
    byte_offset: usize,
    /// [[ArrayLength]]
    array_length: usize,
}
```

You probably get the point: The object features of specialized objects
disappear. A function only carries in it those parts that it must for function
calling to work. All else is delegated to the backing object. The end result is
a slim engine where most of the time your JavaScript objects are only the things
you need them to be, and nothing more.
