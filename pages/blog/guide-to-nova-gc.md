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
and why. If you're interested in contributing to Nova, this will be very useful
reading. If you're only interested in seeing what the fuss is all about, then
you might only want to read the first one or two chapters.

## The Theory

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
println!(value.str_repr(agent));
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

## The Practice

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
   `NoGcScope` or `GcScope`, implicitly or explicitly.

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
let first = silly_example(agent, gc.reborrow());
let second = silly_example(agent, gc.reborrow());
println!("{:?} {:?}", first, second);
```

This will not compile. The error will say that `gc` is borrowed as exclusive at
the first `gc.reborrow()` call site, is then again borrowed as exclusive at the
second `gc.reborrow()` call site, and the first exclusive borrow is later reused
on at the print line. This is our first useful error from out bound values:

Both the calls to `silly_example` can trigger garbage collection. If the second
call does trigger garbage collection, then the `first` `Value` will be
use-after-free. The compile error here is absolutely on point: This is an error.

But okay, what if we were calling `Value::from_string` instead?

```rust
let first = silly_example(agent, gc.reborrow());
let second = Value::from_string(agent, "foo".into(), gc.nogc());
println!("{:?} {:?}", first, second);
```

This still will not compile! The error message says that `gc.reborrow()` borrows
`gc` as exclusive, and `gc.nogc()` then borrows it as shared but the exclusive
borrow is then reused when `first` is printed. From a garbage collector
perspective this makes no sense: The `first` `Value` returned from
`silly_example` will not be invalidated by a `Value::from_string` call, so why
is this happening?

The reason is buried deep into Rust's internal mutation types, and we'll skip
why it is so: We'll just accept that it needs to be this way for a good reason
and we'll live with it. But, it _is_ a problem for us: Putting this into problem
into garbage collector terms, what Rust here is telling us is that while `first`
lives, garbage collection is still happening and trying to access the `GcScope`
at the same time would be equivalent to allowing two garbage collections to
happen at the same time. That sounds dangerous and it makes sense we're stopped
from doing that, but we know that wouldn't be the case: Garbage collection has
potentially started and finished inside the `silly_example` call if it did.

A `Value` is just a handle, an integer of some kind that the `Agent` can use to
find the associated heap data, and importantly the `Agent` does not trust a
`Value` to contain correct data: All heap data access is always checked. Hence,
we can extract the integer data from a `Value` and wrap it into a new `Value`
with a different lifetime without sacrificing memory safety. Now, the perfect
thing would be if we could simply call `bind(gc.nogc())` on our `first`, but
this will not compile because `first` keeps `gc` inactive. What we need to do is
add an `unbind` call first:

```rust
let first = silly_example(agent, gc.reborrow())
    .unbind()
    .bind(gc.nogc());
```

This will now compile, despite looking a little ugly. (Maybe more than a
little.) The `unbind` call releases the `gc` from the `gc.reborrow()`'s
temporary exclusive borrow, after which we can immediately call
`bind(gc.nogc())` on it to bind it back to the `GcScope` but this time with a
shared borrow backing it.

This is our first problem and solution: When returning a strongly bound value,
`GcScope` will remain inactive. To fix this, chain `.unbind().bind(gc.nogc())`
to the call. Note: There is no runtime cost for doing these calls, though there
likely is a small compile time cost.

### Passing bound values to `NoGcScope` functions

This is going to be easy: Passing bound values as parameters to `NoGcScope`
functions works just like you would expect from normal Rust:

```rust
let first = Value::from_string(agent, "3".into(), gc.nogc());
let result = to_number_primitive(agent, first, gc.nogc());
```

Because the `first` value isn't invalidated by the `gc.nogc()` call, passing it
into the call is perfectly okay from Rust's perspective.

### Passing bound values to `GcScope` functions

This is not going to be quite so easy, but you probably guessed that already.
When `gc.reborrow()` is called, all bound values are invalidated immediately and
trying to use them afterwards becomes an error:

```rust
let first = silly_example(agent, gc.reborrow()).unbind().bind(gc.nogc());
let child_gc = gc.reborrow(); // <-- Conceptually, Rust thinks garbage collection happens here.
let result = to_number(agent, first, child_gc); // Error: `first` is now use-after-free!
```

Even if we call the `gc.reborrow()` "within" the `to_number` call, the `first`
value will become invalidated "after-the-fact" and the call itself now becomes
invalid:

```rust
let first = silly_example(agent, gc.reborrow()).unbind().bind(gc.nogc());
let result = to_number(agent, first, gc.reborrow()); // Error! Trying to pass exclusive and shared reference together.
```

This is again an aliasing error and the borrow checker will not stand for this.
So, what do we do? Conceptually, we again know that calling `gc.reborrow()`
doesn't trigger garbage collection but something inside `to_number` may do so.
Hence, passing `first` as a parameter is perfectly legal here, especially since
it (again) does not put memory safety at risk. So, we can use the `unbind`
method to release `first` from the `GcScope` borrow before it is passed to the
method:

```rust
let first = silly_example(agent, gc.reborrow()).unbind().bind(gc.nogc());
let result = to_number(agent, first.unbind(), gc.reborrow()); // No error.
```

This is our second problem and solution: When calling a method that takes
`GcScope`, we cannot pass bound values into that same call. To fix this, we must
call `.unbind()` on the parameter bound values. To be safe, this should only be
done at the call site and not before. The following would be _incorrect_:

```rust
// *Incorrect* usage!
let first = silly_example(agent, gc.reborrow()).unbind().bind(gc.nogc());
let result = to_number(agent, first, gc.reborrow()); // No error.
let other_result = to_number(agent, first, gc.reborrow()); // Uh oh, no error! `first` is now use-after-free!
```

This is also the reason why `GcScope` is always the last argument.

### Taking bound values as parameters in `NoGcScope` functions

There is nothing particularly complicated here, again. These functions work in
all ways very much like normal Rust functions:

```rust
fn my_method(
    agent: &mut Agent,
    value: Value,
    gc: NoGcScope
) {
    // ... do your thing ...
}
```

Because no garbage collection can happen within this function scope, the `value`
is guaranteed to stay valid until the end of the call.

### Taking bound values as parameters in `GcScope` functions

Once again, functions that may trigger garbage collection are the problem child.
When we receive a parameter `value: Value` in a call, by normal Rust lifetime
rules the `Value<'_>`'s contained lifetime is guaranteed to be valid until the
end of this call. In our case, we do not want that to be the case; the lifetime
should be bound to the `GcScope` but there is no way to make Rust perform this
binding automatically. We must thus perform it manually: You can think of this
as the mirror of the `.unbind()` call we needed to perform when calling a
`GcScope` function earlier.

```rust
fn my_method(
    agent: &mut Agent,
    value: Value,
    gc: GcScope
) {
    let value = value.bind(gc.nogc());
    // ... do your thing ...
}
```

All bindable values should be bound in this way at the beginning of every
function that takes `GcScope`: This is the _most_ important thing in Nova's
garbage collector by far. If this rule is not upheld, then getting
use-after-free in the engine is trivial or even guaranteed. If this rule is
upheld, then getting any further use-after-free becomes nearly impossible.

Luckily, this is fairly easy conceptually: You need only to bind your parameters
and you're good to go. Unfortunately, we know that "just doing the right thing"
is not quite that easy (see null pointer checks). For that reason, we plan on
implementing a custom lint to check this at build time.

### Holding bindable values across `GcScope` function calls

One final, important thing is left to discuss: We've seen how bindable values
are formed and passed around, and how they become invalidated whenever a garbage
collector triggering function call is made. This is great because it makes sure
that we don't use these values after they may have been moved or free'd. But
what if we need to use a bound value after a function call? For example, what do
we do in this sort of situation:

```rust
fn example(
    agent: &mut Agent,
    arg0: Value,
    arg1: Value,
    gc: GcScope
) {
    let arg0 = arg0.bind(gc.nogc());
    let arg1 = arg1.bind(gc.nogc());

    let start_index = to_length_or_infinity(agent, arg0.unbind(), gc.reborrow())?;
    let end_index = to_length_or_infinity(agent, arg1.unbind(), gc.reborrow())?; // Error: arg1 is use-after-free
}
```

This will not compile, and it is a perfectly valid error: if garbage collection
is triggered by the first `to_length_or_infinity` call, then `arg1`'s data would
be moved or removed. Continuing to use it would be well and truly mistaken.

But, we cannot just not use `arg1`: we need both `start_index` and `end_index`
so we need to somehow make sure that `arg1` can be used and stays valid across
the first `to_length_or_infinity` call. The answer to how to do that is,
emphatically, _not_ `let arg1 = arg1.unbind();`. That would be a big, big
mistake as it just makes the code compile but would not work correctly.

What we need to do, instead, is to "scope" or "root" `arg1`. (The terms are
interchangeable in this context.) What this does is to write the `arg1` `Value`
onto the `Agent` heap, into a location that `Agent` guarantees will not be
changed by the garbage collector, and returns a handle to it. This is a second
level handle, if you will: Our original `Value` is a handle to some data on the
heap, and rooting it moves that onto the heap and returns a handle. This second
level handle has a different type, `Scoped` and is defined automatically for all
bindable, rootable values.

```rust
trait Scopable: Rootable + Bindable
where
    for<'a> Self::Of<'a>: Rootable + Bindable,
{
    fn scope<'scope>(
        self,
        agent: &mut Agent,
        gc: NoGcScope<'_, 'scope>,
    ) -> Scoped<'scope, Self::Of<'static>> {
        Scoped::new(agent, self.unbind(), gc)
    }
}
```

For our `Value`, this would simplify to the following `scope` function
implementation:

```rust
impl Value<'_> {
    fn scope<'scope>(
        self,
        agent: &mut Agent,
        gc: NoGcScope<'_, 'scope>,
    ) -> Scoped<'scope, Value<'static>> {
        Scoped::new(agent, self.unbind(), gc)
    }
}
```

Note that we're now using the second lifetime of the `NoGcScope`, this is the
"scope" lifetime which works like your usual Rust lifetimes: a type carrying the
scope lifetime is guaranteed to be valid for the whole function call. From a
validity standpoint, this is because the `Agent` removes these scope-rooted
handles from the heap only at outside of user-controlled code. Garbage
collection does not remove them, so they do not need to be bound to the garbage
collector lifetime.

Now that we know of scoping, this is how we would use it:

```rust
fn example(
    agent: &mut Agent,
    arg0: Value,
    arg1: Value,
    gc: GcScope
) {
    let arg0 = arg0.bind(gc.nogc());
    // We scope the argument value. The resulting scoped value is guaranteed to
    // be valid until the end of this call.
    // Note that we could bind and then scope the value, but that would not
    // make any difference to the resulting code or its correctness.
    let arg1: Scoped<'_, Value<'static>> = arg1.scope(agent, gc.nogc());

    let start_index = to_length_or_infinity(agent, arg0.unbind(), gc.reborrow())?;
    // To get our bindable value back out form a scoped value, we can use a get
    // method on it. This returns a `Value<'static>`, which we can leave
    // unbound because we're passing it as a parameter immediately.
    let end_index = to_length_or_infinity(agent, arg1.get(agent), gc.reborrow())?;
}
```

With this, we've successfully held `arg1` across a `GcScope` function call,
ensuring that its data will not be removed by the garbage collector (it will
still be moved, but on the heap the scoped value's data will be updated to point
to the new location).

## The Mastery

Now we know how to work with bindable values at function interfaces, and we know
how to create scoped values and use them to keep bindable values from being
invalidated by the garbage collector when we need them to stay. All that remains
is the all important question of "how do I actually use these things?!" True
mastery can only come from practice, from trying and failing, and trying again
until the tools break in your hands. I've never known how to create masters, but
I've seen the tools break in my hands a few times by now, so I can hopefully
give you a few tricks.

These will be in no particular order, snippets of code that pose challenges and
the answers therein. Koans, if you will.

### Short-circuit returning bound values from `GcScope` functions

If your function calls a function and immediately returns the result, you'll
find that using `gc.reborrow()` or `gc.nogc()` will not work.

```rust
fn my_method<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a> {
    // ...
    to_number(agent, some_value, gc.reborrow()) // Error: Returning value bound to local variable.
}

fn my_method_2<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a> {
    // ...
    Value::from_string(agent, "foo".into(), gc.nogc()) // Error: Returning value bound to local variable.
}
```

The reason for this is that our `gc.reborrow()` and `gc.nogc()` are not "true
reborrows", their contained `'a` lifetime is always guaranteed to be shorter
than the source `GcScope<'a, '_>` is, but our return type requires the lifetime
to be equal to `'a`. (This isn't exactly the reason, actually, but it's
technically the same thing. The real reason is the temporary borrow. Whatever.
Deal with it.)

There are two ways to fix this. The first, preferred one, is to consume the
`GcScope` variable to get an equal `'a` lifetime. This can be done by passing
the `gc` directly (for `GcScope` functions) or by using the `gc.into_nogc()`
method:

```rust
fn my_method<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a> {
    // ...
    to_number(agent, some_value, gc) // No error
}

fn my_method_2<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a> {
    // ...
    Value::from_string(agent, "foo".into(), gc.into_nogc()) // No error
}
```

Note that both of these actions invalidate all bound values; for the
`gc.into_nogc()` method this is quite unfortunate as we actually know that it
signifies the end to all possibility of garbage collector triggering in this
call, and that henceforth all bound values are strictly guaranteed to stay valid
until the end of the call. If you are passing bound values into the call
together with the result of `gc.into_nogc()` then you can use `.unbind()` on the
parameters at the call site the same way as you'd normally use for a
`gc.reborrow()` call.

The second way to handle this issue is by simply calling `.unbind()` at the
return site: This is likewise perfectly fine, and perfectly safe. Especially if
you are passing bound values into a `NoGcScope` call and returning the result
then this may sometimes be the cleaner option:

```rust
fn my_method<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a> {
    // ...
    to_number(agent, some_value, gc.reborrow())
        .unbind() // No error
}

fn my_method_2<'a>(
    agent: &mut Agent,
    gc: GcScope<'a, '_>
) -> Value<'a> {
    // ...
    Value::from_string(agent, "foo".into(), gc.nogc())
        .unbind() // No error
}
```

The question is: How to ensure that a bound value lives long enough to be
returned? The answer is, by consuming the `GcScope`. Or when under duress, by
unbinding the value at the site of return.

### Splitting a function's tail into a `NoGcScope` part

Oftentimes, functions will call into `GcScope` functions at the start but later
move to operating purely with `NoGcScope` functions.
