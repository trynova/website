---
title: Guide to Nova's garbage collector
description: An in-depth, step-by-step tutorial for all your garbage disposal needs!
date: 2025-03-01
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

We recently merged a large and important
[pull request](https://github.com/trynova/nova/pull/562) that added a lifetime
to our JavaScript `Value` type. As a result, the borrow checker is now a lot
noisier and up-in-your-business about how you should write code inside the
engine, as well as how embedders interface with it.

This is not a trivial system, so this post is intended as a step-by-step
tutorial into understanding the garbage collector, how it uses the borrow
checker, how it needs to be handled, and what sort of errors does it give you
and why.

## The theory

Nova uses an exact or precise tracing garbage collector. A tracing garbage
collector is one where the garbage collector algorithm follows references
between items to find new items, and marks the items it has seen. Once it no
longer finds new items, the algorithm then releases all unmarked ones. An exact
or precise tracing garbage collector is one that is guaranteed to only known
live items.

The difference between an exact and a conservative garbage collector (which
traces all possible live items) is, generally, in that a conservative garbage
collector will look for data that looks like a potential reference to a garbage
collected item and traces any items it finds this way. An exact garbage
collector will not search for "potential" references like this, instead it uses
some compile-time guarantee to only look for items in statically known places.

Nova's garbage collector uses lists of "roots" in the `Agent` and starts tracing
from these lists. What this effectively means is that if a JavaScript `Value`
type is being used by code and is eg. saved to a local variable in a function
when garbage collection gets triggered, the garbage collector will not see this
local variable. This results in a use-after-free.

```rust
// Value in a local variable; it refers to an object's data on the heap.
let value: Value<'_> = OrdinaryObject::create_empty_object(agent).into_value();
// Garbage collector runs; it does not see any references to the object.
agent.gc();
// The object has been free'd now, this is use-after-free!
println!(value.str_repr(agent)
```

Nova uses Rust's borrow checker to guard against this kind of use-after-free
issues. Unfortunately, the method of doing this is by necessity somewhat manual
and does not quite resemble your run-of-the-mill Rust fight with the borrow
checker. This is kung-fu with borrow checker!

### `GcScope`

Garbage collected values in a tracing garbage collector system do not have a
"single owner" in the traditional Rust sense: You cannot point to a garbage
collected value in memory and say "this value owns its own memory", and much
less can you point to a reference between two values and say "the referee owns
the referrent". Garbage collected systems allow for multiple referees but none
of these references imply ownership over the memory. All the memory is owned by
the garbage collector, communally if you will. In Nova's case this means that
the `Agent` owns all value's heap data.

Garbage collected systems also do not generally subscribe to Rust's "exclusive
or multiple shared references" paradigm of write access. In JavaScript's case,
all data is always up for mutation by anyone who can access it. This means that
when we ascribe a lifetime to `Value`, that lifetime cannot be bound to the
borrow on `Agent`: It is perfectly valid for mutations to happen on the
`Value`'s data while we still hold the `Value` reference, and we are fully
allowed to read and write to its data before and after said mutations.

The "validity" of a value is thus not based on possible mutations on it, but
instead on garbage collection. A garbage collectable value stays valid to use
without limit until garbage collection happens. For this purpose Nova has the
`GcScope` zero-sized type (ZST) that gets passed through call graphs where
garbage collection may happen, and its sibling `NoGcScope` which is passed into
call graphs where garbage collection cannot happen. The `GcScope` is needed to
trigger garbage collection, and it cannot be cloned or copied but it can be
"reborrowed" to pass a temporary copy down into deeper call graphs: While this
temporary copy lives, the original is "inactive" and cannot be used.

`NoGcScope` is likewise created from `GcScope` through reborrowing, but it does
not stop the original from being used to create other `NoGcScope`s. In Rust
parlance, to create a temporary `GcScope` copy the original must be borrowed
exclusively, while `NoGcScope` can be created through a shared borrow.

```rust
// Note: Lifetime generics omitted for simplicity.
impl GcScope {
    fn reborrow(&mut self) -> GcScope;
    fn nogc(&self) -> NoGcScope;
}
```

All values bind their lifetime to the `GcScope` through the use of a
`NoGcScope`. Because a `GcScope` is required to trigger garbage collection and a
`GcScope` can only be passed to a function call either by value or by using the
`reborrow` function which requires exclusive access to `self`, it means that any
time that a `GcScope` gets passed passed to a function call it invalidates all
shared borrows on it, which invalidates all `NoGcScope`s, and that then
invalidates all values that have bound their lifetime to the `GcScope` through
the use of a `NoGcScope`.

With this, we have a system where all garbage collected values bound to the
`GcScope` are automatically invalidated when garbage collection may be triggered
(because we call a function that may trigger garbage collection). Unfortunately,
this is not the end: We haven't yet defined what "bound values" are, and that is
an important and problematic thing to define.

### Bindable values

Bindable values in Nova are handles to heap data that carry a Rust lifetime. The
most common bindable value type is `Value`, but many others exist besides. (Some
examples would be `Number`, `String` [not the standard library one], `Symbol`,
and `Object`.) Normally, in Rust you see lifetimes mostly in references. For
reasons explained above, Nova cannot use the `Agent` reference to derive the
lifetime for bindable values. Nova also cannot quite use normal Rust lifetime
rules directly due to Rust not allowing aliasing. For this reason, bindable
values implement the following trait:

```rust
unsafe trait Bindable {
    type Of<'a>;

    fn unbind(self) -> Self::Of<'static>;
    fn bind<'a>(self, gc: NoGcScope<'a, '_>) -> Self::Of<'a>;
}
```

The `Of` type is expected to (and once possible to check, be required to) be
equal to the `Self` type. For example, this is how `Value`'s implementation
begins:

```rust
unsafe impl Bindable for Value<'_> {
    type Of<'a> = Value<'a>;
}
```

What this says, effectively, is that for any `Value`, regardless of what
lifetime it has, it has a function `unbind` that takes self (by value, not by
reference) and returns a `Value<'static>`, and a `bind` function that again
takes takes self and a `NoGcScope<'a, '_>` and returns a `Value<'a>`. You can
perhaps see where this is going: "Bound values" mean values that carry the `'a`
lifetime from a `NoGcScope<'a, '_>`, either from having had `bind(gc.nogc())`
called on them, or from being returned from a function that takes a
`NoGcScope<'a, '_>` and returns the value with the `'a` lifetime.

It is also possible to get "exclusively bound values"; these are created when a
bound value is returned with the `'a` lifetime from a function that takes
`GcScope<'a, '_>`, ie. when a bound value is returned from a function that can
trigger garbage collection. Due to certain details of Rust's borrow checker
rules related to internal mutation, the returned value will keep the `GcScope`
from being reused. We'll see how to deal with this situation later.

## The pratice

Now that we have seen the `GcScope`, `NoGcScope`, and bound values, we are ready
to start using them in practice. First, let's do a quick review of these three
principal actors:

1. `GcScope<'a, '_>`: A zero-sized type that is passed to functions that can
   trigger garbage collection. Only one such type is ever active at a time, and
   no `NoGcScope`s can be active at the same time.
2. `NoGcScope<'a, '_>`: A zero-sized type that is passed to functions that
   cannot trigger garbage collection. Any number of such types can be active at
   the same time, but no `GcScope` can be active at the same time.
3. Bound values: Handles to garbage collected values that have been bound to a
   `NoGcScope` or `GcScope`, implicity or explicitly.

With this, we're ready to start our praxis.

### Returning bound values from `NoGcScope` functions

The simplest function that deals with bound values we can imagine in the engine
is one that cannot trigger garbage collection, and returns a bound value. An
example of this would be `Value::from_string` which takes a Rust
`std::string::String` by value, moves it to the `Agent` heap, and returns a
`Value` handle to it.

```rust
pub fn from_string<'a>(
    agent: &mut Agent,
    string: std::string::String,
    gc: NoGcScope<'a, '_>
) -> Value<'a>;
```

There is nothing much to say about these sorts of functions: The only thing of
note is that it is important for the `'a` lifetime to be defined and used in
`NoGcScope<'a, '_>`. The following would be _incorrect_:

```rust
// *Incorrect* usage!
pub fn from_string_wrong(
    agent: &mut Agent,
    string: std::string::String,
    gc: NoGcScope
) -> Value; // Wrong! Lifetime not bound to NoGcScope!
```

With this sort of definition, the returned `Value` would be bound to the implied
`'a` lifetime of `&'a mut Agent`, not to the `NoGcScope` lifetime. This would
not be a "bound value". This would also block the entire `Agent` from being used
while the returned `Value` still exists. Even if the blocking were to be fixed
(by making the function take `&Agent` instead), it would still mean that the
handle would be invalidated if the `Agent` is mutated. This isn't correct: We
want the `Value` to be invalidated when garbage collection may be triggered,
which can happen entirely unconnected from heap mutation.

### Returning bound values from `GcScope` functions

Functions that can trigger garbage collection, return bound values, and don't
take any parameters do not actually exist in the engine at all but if they did,
they would look like this:

```rust
pub fn silly_example<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a>;
```

Again, it is important for the `'a` lifetime to be defined and used in
`GcScope<'a, '_>`. It is also worth it to remember that the returned `Value<'a>`
will keep all `GcScope` inactive while it still exists. Again, we'll come back
to this issue soon, but first let's take a look at a simpler case.

### Accepting returned bound values from `NoGcScope` functions

Now that we've learned what functions returning bound values look like on the
outside, let's try calling one in a function body. Since we're starting with a
function that takes `NoGcScope`, this will be easy:

```rust
fn example(
    agent: &mut Agent,
    gc: GcScope
) {
    let string = Value::from_string(agent, "foo".into(), gc.nogc());
    let string2 = Value::from_string(agent, "bar".into(), gc.nogc());
    println!("{:?} {:?}", string, string2);
    // ... presumably more work here ...
}
```

There is nothing particularly odd here, except maybe for the `gc.nogc()` calls.
Our example function takes no bound value parameters (since we don't know how to
do that yet), and merely allocates two strings onto the heap, keeping handles to
them, before printing the two handles.

The `gc.nogc()` calls are needed to create a `NoGcScope` from our `GcScope`
while still keeping it accessible for later calls. The exact lifetime tricks
that happen when `gc.nogc()` is called and the `Value` is returned bound to it
could be annotated thusly:

```rust
let gc: GcScope<'gc, 'scope>;
let gc_ref: &'short GcScope<'gc, 'scope> = &gc;
let nogc: NoGcScope<'short, 'scope>;
let string: Value<'short>;
```

The resulting `NoGcScope<'short, 'scope>` thus says that it keeps the `gc_ref`
borrow alive, and that borrow observes the `GcScope`. If someone were to take
exclusive access to `GcScope`, then the `gc_ref` borrow would be forced to end,
invalidating the `NoGcScope`. Likewise, the returned `string` bound values are
bound to the `'short` lifetime and they are invalidated if exclusive access to
`GcScope` is taken.

### Accepting returned bound values from `GcScope` functions

It is time to look at the issue I've been mentioning above. Let us call our
`silly_example` from above twice and try to print the two results:

```rs
let first: Value<'_> = silly_example(agent, gc.reborrow());
let second: Value<'_> = silly_example(agent, gc.reborrow());
println!("{:?} {:?}", first, second);
```

This will not compile. The error will say that `gc` is borrowed as exclusive at
the first `gc.reborrow()` call site, is then again borrowed as exclusive at the
second `gc.reborrow()` call site, and the first exclusive borrow is later reused
on at the print line. This is our first useful error from out bound values:

Both the calls to `silly_example` can trigger garbage collection. If the second
call does trigger garbage collection, then the `first` `Value` will be use-after-free.
