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

## The basics

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
// Value in a local variable
let value: Value<'_> = OrdinaryObject::create_empty_object(agent).into_value();
// Garbage collector runs
agent.gc();
// Use-after-free
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

With this, we have a system where all garbage collected values bound to the `GcScope` are automatically
invalidated when garbage collection may be triggered
