---
title: "Interlude: A data-oriented model"
description: A real-world example of using data-oriented design principles in TypeScript.
date: 2025-11-16
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Hello again! It hasn't been that long since I [last](./worked-for-the-internet)
blogged, and things are mostly as they were back then. A few meaningful changes
have happened though: first, I am now on a two week (paid!) vacation, intending
to finish up the NLnet grant project before time runs out. Second, I have
received a negative "your project is not eligible" for the main grant
application that I was secretly banking on, which would've set me on a course to
develop Nova full-time for the next two years.

So, put simple I am now very temporarily working for the Internet yet again,
after which I will return to Valmet Automation's sweet embrace. As such, it
seems fitting to talk a little about the data-oriented design principles that
underpin much of Nova, and how I've applied those principles in my day job as a
TypeScript developer.

## A trip down memory lane

This is not the
[first time](https://archive.fosdem.org/2025/schedule/event/fosdem-2025-4391-how-to-lose-weight-optimising-memory-usage-in-javascript-and-beyond/)
I talk about using data-oriented design in TypeScript/JavaScript. In fact, this
is something that I mentioned in the linked talk and which is explicitly
explained in the [talk repository](https://github.com/aapoalas/losing-weight) as
the
["Data Model"](https://github.com/aapoalas/losing-weight/blob/main/src/4_data_model.ts).

The Data Model is mentioned to be

> A fundamental directed acyclic graph underpinning the flow of data from the
> automation system to the user interface. Found to often take ~10 MiB a pop.

and it is made up of node objects that contain four properties:

1. `kind`: this determines the semantic meaning of a node.
2. `in`: this determines the input nodes to this node by naming them in an
   `Array`. Both the order and any duplicates are significant here.
3. `out`: this determines the output nodes of this node by naming them in a
   `Set`. Neither the order nor duplicates are significant here.
4. `data`: this property's value depends on the `kind` and contains any extra
   data needed by the runtime semantics of the node.

These nodes are stored in a `Map<NodeName, DataModelNode>` and in addition,
there exists effectively a `Map<NodeName, unknown>` data storage hash map for
storing the current runtime value of a given node. Updating the Data Model then
means running each node's runtime semantics on its input node's current runtime
value, and storing the resulting value as this nodes' new runtime value.

The four "kinds" of nodes given are `const` which splits into two (actual
constants and references), `subscription`, and `function`. Their runtime
semantics and their associated extra data are as follows:

1. Constant nodes, `kind: "const"`: the node is a constant, has no extra data
   associated with it, and never has any input nodes. Updating a constant simply
   means assigning the new value as the node's new runtime value.
2. Reference nodes, `kind: "const"`: the node is a reference to some other node,
   has no extra data associated with it, and always has exactly one input node.
   Updating the node means reading the only input node's current runtime value
   and assigning it as the reference node's new runtime value.
3. Subscription nodes, `kind: "subscription"`: the node is a subscription into
   the automation network. Its extra data is a collection of parameters and
   options used to affect the subscription's exact semantics, and these nodes
   are known to always have one or two input nodes: the first input node
   contains the subscription address, and the second optional one is a dynamic
   object of parameters. Updating a subscription node means unsubscribing the
   previous subscription address (if non-null), subscribing the new address (as
   given by the first parameter node's runtiem value), and setting the
   subscription node's current runtime value to `null`. When the subscription
   from the automation network responds with data, that data is set as the
   subscription node's current runtime value and an update is dispatched to its
   output nodes.
4. Function nodes, `kind: "function"`: the node is a function on its inputs. Its
   extra data is the function name (to be looked up from a function storage
   Map). Updating the node means reading the current runtime values of its input
   nodes, and running an actual JavaScript function with those values as the
   arguments. The result of the function is stored as the new runtime value of
   the function node.

The way these nodes are constructed is by, effectively, parsing a
JavaScript-based domain-specific language (DSL) that looks something like this:

```javascript
let tag = "LIC-100";
let address = combineStrings("/plant/", ref("tag"), "/isGood");
let isGood = negate(subscription(ref(address)));
```

The `tag`, `address`, and `isGood` are properties and their values are parsed as
parts of the Data Model. `tag`'s value `"LIC-100"` is parsed as just a constant,
while `address` is parsed as a function node calling a function by the name of
`combineStrings` with three parameters: the first one is a constant parameter
`"/plant/"`, the second is a reference node pointing to the property `tag`, and
the third one is again a constant parameter with value `"/isGood"`. Finally, the
`isGood` property is parsed as a function node calling the function `negate`
with the value of a subscription node that takes as its address a reference node
pointing to the property `address`.

At this point, I want to ask a question: do you think that the object based node
structure seems to make sense? Ponder to yourself for a moment, is this the kind
of code that you'd write? Or do you see silliness that you know you'd never
commit to?

I am not quite sure myself: by now all of this code was either written or
rewritten by me at some point, although I did inherit the basic structure of it
originally. So obviously I thought this made sense, but I'm not entirely sure if
I would write it anymore. At the very least it's clear to me that there are
issues in this code, though they may not be dealbreakers depending on the
use-case.

## I am altering the deal...

The main issues in the existing implementation become quite clear when we look
at it in the details. The very first issue is simply the memory usage: in Chrome
each node object took up `(3 + 4) * 4` (3 for the object header + 4 inline
properties) or 28 bytes. Add to that the 16 bytes needed for both the `in`
`Array` and the `out` `Set` and we're already at 60 bytes, or nearly a full
cache line of data for a single node. Add in the `out` `Set`'s backing memory
allocation, which is done even when the `Set` is empty and takes probably more
than a full cache line on its own, and we're probably easily over two or even
three cache lines of data. The total memory usage for an empty node is probably
something around 150 bytes.

But there are structural issues with the nodes as well. First, while nodes
belonging to properties like `tag` or `address` can have references pointing to
them, there is no way for a reference to refer to eg. the `"/plant/"` constant
parameter "inside" the `address` property's node graph: this means that we know
that all "parameter" nodes must always have exactly one output, which is the
node that they are a parameter of. This makes the outputs `Set` seem quite
ridiculous indeed with its large backing memory allocation used to store just a
single node name string most of the time. Second, the number of inputs is often
small and statically known (0 for constants, 1 for references, 1 or 2 for tags);
even for functions we know the number of inputs for a given function node during
parsing so we have no need for a dynamically resizable container to store the
input names. This makes the `in` `Array` seem quite ridiculous as well.

Third, constant parameter nodes (like the `"/plant/"` string) do not really
serve any purpose: we just want to know that they are constant parameter nodes
but the node object itself has nothing of value to us: the output is never
needed as the constant parameter can never change (meaning that we never ask the
question "what is the output of this constant parameter node"), the inputs Array
is known to be empty, and no extra data exists for constants. The only thing
we're interested in is the current runtime value of the node, and that is stored
in a separate `Map`.

Fourth, reference parameter nodes do not really serve any purpose: instead of
creating a separate node whose only purpose is to have an input pointing to eg.
`tag`, we could just as well remove that entire node and have the reference
node's output (usually a function or subscription node) refer to that `tag`
directly.

The third and fourth issues I had already taken care of ages ago; constant and
reference parameter nodes do not exist in the Data Model at all. The first and
second points I hadn't fully realised yet, but I had plans...

## ... pray I don't alter it any further

I had actually seen some other issues as well. The `kind` field was a huge waste
of memory, taking up an entire JavaScript Value (4 or 8 bytes depending on the
engine) to store what amounted to 2 bits of information (one of 4 options).
Likewise, the extra data for subscription nodes was horrendously inefficient,
storing a set of JavaScript booleans in an object with each boolean fully filled
in with its default value if not explicitly defined in the source DSL, so as to
optimise object shapes. That meant using many tens of bytes to store what
amounted to a few bits of data.

But even had I fixed all of these issues, the reality was still that our Data
Models can get really big, too big. We're talking half a million to a million
nodes per Data Model, and there is no exact limit to how many Data Models a user
can have open at the same time. (Funny story, a particular customer had noticed
a cool trick where they could sort of minimise parts of the UI and then use a
double-click feature to bring it quickly back into view. This meant that they
had tens of large Data Models running simultaneously, as opposed to the expected
count of low single digits. Users are clever!)

At those numbers, just the object headers for a single Data Model's nodes add up
to nearly 6 MiB. My bet for solving this issue was thus not to try shrink the
JavaScript node objects at all, but to remove them entirely! And this is where
we get to the data-oriented design part of the blog post.

## Lining it all up

The answer to all of this was obviously to take matters into my own hands using
ArrayBuffers and TypedArrays. The `kind` field could easily fit into a
`Uint8Array`, while the others seemed to be begging for a bit of a rethought.

I'm going to skip to the end here, and just tell you what I did: the final
result was that a single Data Model node is an index in three TypedArrays: the
`kindColumn`, the `outColumn`, and the `payloadColumn`. These three form what
could be called the "node table". Additionally, an `extraDataColumn` exists on
the side that has a length dependent on the contents of the node table. In this
transformation, the number of node `kind`s shot up from 3 (effectively 4) to 7,
and they are now of course number values stored in a `Uint8Array` instead of
strings like before. The `kind`s are:

1. Constant node: same as before.
1. Reference node: same as before, except now with a different `kind` value.
1. Nullary function node: a function taking no parameters.
1. Unary function node: a function taking one parameter.
1. N-ary function node: a function taking two or more parameters.
1. Subscription node: a subscription node with no non-boolean options (`minTime`
   / `maxTime`) or dynamic parameters, ie. only has one input node.
1. Parametrised subscription node: a subscription node with some non-boolean
   options or dynamic parameters. This has one or two input nodes.

Each node has an `out` value (stored in the `outColumn`) which is a relative
offset forwards in the node table pointing to the node's output node. If the
relative offset is 0, then this node is a property node. In these cases, the
node has extra data (like the incoming references to this property) available in
a separate "property table" which I'm going to gloss over today.

Finally, the `payload` value of each node (stored in the `payloadColumn`)
depends on the `kind` of the node, but a common theme is that in most cases the
payload is an index into some storage `Array`. They go like this:

1. Constant node: the payload is an index into a global array of constant
   values.
1. Reference node: the payload is an index into a global array of property
   names.
1. Nullary and unary function nodes: the payload is an index into a global array
   of function names.
1. N-ary function node: the payload is an index into the local
   `extraDataColumn`. The pointed-to index contains an index into the global
   array of function names, the index after that is the number of inputs this
   function node has, and subsequent indexes after that contain relative offsets
   backwards in the node table pointing to each input node.
1. Subscription node: the payload is a bitset of the boolean options of the
   subscription.
1. Parametrised subscription node: the payload is an index into the local
   `extraDataColumn`. The pointed-to index contains the bitset of boolean
   options and bits indicating which of the `minTime`, `maxTime`, and two input
   parameter offsets are stored in subsequent indexes of the extra data.

If you've heard [how Zig builds its compiler](https://vimeo.com/649009599), this
might sound very familiar because it's very much the "encoding strategy" as
named by Andrew Kelley. The `kind` is used to store not just the "kind" of node
we're dealing with but also some information about its data contents, which then
means that we can skip storing that information, simplifying the required
storage format.

Now, the `kindColumn` is always a `Uint8Array` so each `kind` field costs 1 byte
of memory, but the `outputColumn` and `payloadColumn` I haven't given a concrete
type for yet: this is because they do not have a guaranteed type. I'm taking
advantage of the fact that these have fairly similar contents between one node
and the next, and am thus eagerly allocating them using the smallest possible
unsigned integer TypedArray that fits the current data: generally this means
that `outputColumn` is a `Uint8Array`, and `payloadColumn` is either a
`Uint16Array` or a `Uint32Array`. As a result, a single "base node" is 6 bytes
in size. Compared to the 60 bytes we started off with we have cut memory usage
of a node 10x, or more if we count in the output `Set`'s backing memory
allocation.

The "node table" has thus changed from this:

```typescript
interface DataModelNode {
  kind: string;
  in: NodeName[];
  out: Set<NodeName>;
  data: unknown;
}
type NodeTable = Map<NodeName, DataModelNode>;
```

into this

```typescript
interface NodeTable {
  kindColumn: Uint8Array;
  outputColumn: Uint8Array | Uint16Array | Uint32Array; // usually Uint8Array or Uint16Array
  payloadColumn: Uint8Array | Uint16Array | Uint32Array; // usually Uint16Array or Uint32Array
  extraDataColumn: Uint8Array | Uint16Array | Uint32Array; // usually Uint16Array or Uint32Array
}
```

The number of objects is cut from `1 + N * 3` where `N` is the number of nodes,
to just 6 (counting a single shared `ArrayBuffer` shared between all the
columns), no matter the number of nodes (and we actually make `extraDataColumn`
`null` if it is empty, and we drop the node table entirely if it is empty, so
the number of objects can go to 5 or 0). All in all, the memory usage seen in
real usage went from more than 10 MiB to a bit over 1 MiB.

## Get your ducks in a row

Okay, that sounds wonderful: should everything be written like this from now on?
Well, yes and no. TypeScript isn't exactly the easiest language to use
semi-manual memory management like this in
([maybe we can make it a little better, though?](https://github.com/microsoft/TypeScript/issues/62752)),
so the code complexity downside on its own might make this whole thing untenable
in the small. But the final nail in the coffin is that TypedArrays and
`ArrayBuffer`s are massive objects in at least the V8 engine. If you have only a
few objects, then the cost of a TypedArray will overwhelm the cost of a few
objects. Only once you get into multiple tens of objects does the math change.

That code complexity though: no matter how numerous your objects, it doesn't
really change the code complexity. This kind of code is and looks foreign: the
best thing you can probably do is create helper classes that encapsulate the
indexing behind APIs like `getNodeKind` and `getFunctionName`. Soon enough
you'll find yourself arguing between safety and performance: should
`getNodeKind` explicitly throw if the passed-in index is out of bounds? Should
`getFunctionName` check that the passed-in index really points to a function
kind, or should it simply interpret the node payload as a function name index
and read into the global function name array? In Rust that would be accessing a
`union` field without a check that the field is necessarily valid, which would
make the calling function `unsafe`: do you start naming some functions as
`unsafeGetFunctionName`, or is that a bridge too far?

I've glossed over all of those complexities here, and for a good reason I think:
nobody wants to read 2000 lines of dense, unfamiliar TypeScript code. Just rest
assured that the code exists, it works, has been tested, is heading into
production, and even achieves a fairly good compile-time type safety to boot. It
just isn't trivial. When I return to work in two weeks time, I'll be returning
to more of this same work; the Data Model is split into two parts, a static
version of it that is created once and used as a template when instantiating
dynamic Data Models, and the dynamic side. I've only done the static version so
far (which also gives me some extra benefits and ease of implementation that
I've taken advantage of here), and next up will be the real deal: dealing with
the actual, dynamic runtime Data Models.

But before that, it's back to Nova JavaScript engine and Rust for me. Thanks for
reading, I'll see you on the other side.
