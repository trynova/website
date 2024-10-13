---
title: Taking out the trash
description: Pondering a garbage collector in the world of Rust.
date: 2024-10-13
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

[Many](https://coredumped.dev/2022/04/11/implementing-a-safe-garbage-collector-in-rust/)
[people](https://kyju.org/blog/rust-safe-garbage-collection/)
[have](https://github.com/fitzgen/safe-gc)
[taken](https://manishearth.github.io/blog/2021/04/05/a-tour-of-safe-tracing-gc-designs-in-rust/)
a [stab](https://github.com/DuckLogic/zerogc) (and succeeded) at implementing
safe garbage collection system and libraries in Rust. Why couldn't I? Why
shouldn't I? And why I should but also really, really shouldn't.

This is less a blog post and more a soliloquy, for which I apologize. Join me in
a disjointed ramble through garbage collection in a Rust JavaScript engine.

## Entering the garbage heap

A garbage collector's job is to deallocate data that is no longer needed by
anyone. The definition of "need" is undecidable, so we instead have to accept
the lesser but decidable definition of "reachable". A piece of data is not
reachable if there are no incoming references to it. The first instinct would be
to say that this sounds like a fairly reasonable thing to do: Just have
references from object to object, and follow those while making note of which
objects you've seen. At the end remove all objects that you didn't see.

The problem is first that we don't really know where to start following these
references, and second of all Rust really does not like the idea of keeping
references between objects alive. We could downgrade the references to pointers
and Rust's borrow checker would no longer be angry, but you would then have to
wrestle with the usual problems of use-after-free, double-free, and other memory
safety issues. No, that way is sealed for us.

Greater people have walked this road before, and they've gone on to do great
things. See the links in the preamble for a sampling of these. However, at the
end of the day what they've done is taken pointers, added some lifetime magic on
top and made it good. That is not to say what they've done is bad, far from it.
The problem is that they are using pointers, and I don't like pointers. They're
coarse and rough and irritating, and they get everywhere. No, what I like is
indexes. They're small and slick and neat. Only one thing, though: They don't
work alone. An index is an index to _something_, and without that something it
is but an integer.

So, I will need to do what greater people have done before me and create a safe
garbage collector but this time for fancy integers, which then also requires
keeping "something more" around for the integers to refer to. No biggie.

## What's that garbage truck there?

Oh, that's just the existing garbage collector. It's not really very robust, and
it can only run at night. See, Nova has a GC but it is not an interleaved GC.
The GC can only run when no JavaScript is running, and as a result things like
JavaScript benchmarks are basically guaranteed to eventually crash from going
out of memory. In addition, the JavaScript Values have no Rust lifetime attached
to them, so it's very easy to make a mistake and use a Value that is no longer
valid after that `agent.gc()` call you made. See, Nova's garbage collector is a
moving garbage collector and a very aggressively moving one at that. It is
rather likely that a Value that the user is currently touching will indeed move
(or rather, its data moves) during garbage collection.

Here's what the current GC looks like:

```rs
let agent = GcAgent::new();
let realm = agent.create_default_realm();
agent.run_in_realm(realm, |agent| {
    let result = agent.evaluate_script(script_source);
    // ...
});
agent.gc();
```

and internally a builtin JavaScript function looks something like this:

```rs
fn array_prototype_map(agent: &mut Agent, this: Value, args: &[Value]) -> JsResult<Value> {
    // ...
}
```

If we want interleaved garbage collection, that means that eg. when
`Array.prototype.map` calls the `callback` functions (which are likely to be
user-defined ECMAScript functions, not builtins) then it should expect the
`this: Value` and `callback: Value` to potentially move during that call. If we
can use Rust's lifetimes to guarantee that code must be written with the chance
of garbage collection in mind, then we can implement a "safepoint garbage
collector".

## Safe space for trash collectors

A safepoint garbage collector relies on static knowledge (usually by convention
or linter, but in our case by construction through Rust's lifetimes) to perform
GC at known points in the code: All callers must at this point have their
valuables stashed away somewhere safe, and the trash collectors may take away
the rest. This seems like a very reasonable approach to take, and I don't know
of many other realistic approaches to interleaved garbage collection so I'll
take it.

It would be natural to bind our Values to the `&mut Agent` lifetime: This
exclusive lifetime is effectively what controls our JavaScript execution.
Without the exclusive lifetime, JavaScript cannot be run and hence garbage
collection cannot be (strictly) necessary. We can even write this as code easy
enough:

```rs
fn array_prototype_map<'gc>(
    agent: &'gc mut Agent,
    this: Value<'gc>,
    args: &[Value<'gc>]
) -> JsResult<Value<'gc>> {
    // ...
}
```

This will compile, but the function cannot be called. As the lifetimes are all
bound together and one of them is an exclusive one, calling this function will
make the borrow checker reject the caller code. From a lifetime perspective it
makes sense, but from an engine developer perspective this is unfortunate: Our
`Value` is only a `u8` and a `u32` and it does not hold a real pointer-reference
to the `Agent`, it just holds the lifetime to make sure that the `&mut Agent`
borrow keeps us honest and stops us from using `Value` beyond its safe limits.

There are two ways we can fix this issue. The first is to add an extra level of
indirection, and the second is to add an extra lifetime.

### All problems can be solved by another level of indirection

Adding another level of indirection around `Value` can fix the problem of
calling methods that may perform garbage collection. If the garbage collector
can see and touch the indirected data (the actual `Value`s) while we can only
access them through a `Context` reference, then we've solved our issue!

```rs
fn array_prototype_map(
    ctx: &Context,
    this: Local<'_, Value>,
    args: &[Local<'_, Value>]
) -> JsResult<Local<'_, Value>> {
    // ...
}
```

Internally `Context` must hold at least a `RefCell<Agent>` so that we can still
perform mutations on the Agent's heap but that's a problem for another day. The
one, immediate downside with this is that the `Local` either needs to be an
actual pointer to a `Value` or we need to implement a second `enum Local` that
mostly just copies what `Value` already contains. Either way, this is a pain.

### All problems can be solved by another lifetime

What if we don't add any indirection but instead add an extra lifetime? That
usually solves all problems. Well, no... No matter how we wiggle, we cannot run
away from the fact that we are trying to pass `Value<'gc>`s into a function that
also takes some `&'gc mut` type: The borrow checker will not stand for this.

What we can do is to transmute the `Value<'gc>` into a `Value<'static>`
temporarily, and rebind the lifetimes once inside the function call. But this is
manual programming work that needs to be done in every call, and is very easy to
forget. We can make it harder to forget by instead passing values as
`Register<Value<'static>>` which only give out the inner `Value<'_>` if you give
it the `&'gc` borrow to rebind to. This is better, but it still relies on the
callee to not keep a `Register<Value<'_>>` around.

The benefit of these "register values" (and also why I call them that) is that
they do not perform rooting unless it is going to be necessary. If all functions
take `Local<'_, Value>`s as parameters, then all parameters must always be
rooted (indirected). That is not a wonderful thing, as many parameters are often
unused (see for instance the `thisArg` for `Array.prototype.map` and friends).
Register values means parameters are unrooted when passed, and it is the callees
responsibility to root them if they need to keep the Values beyond a potential
garbage collection point. Similarly, it is the caller's responsibility to root
any Values it wants to keep beyond the call to the callee.

## What's at the root of all this anyway?

Rooting Values is necessary no matter how you slice it. For instance, let us
consider a hypothetical builtin function that calls our `array_prototype_map`
from above and stores the result into a target JavaScript Array:

```rs
fn do_mapping(
    agent: &mut Agent,
    target: Register<Array<'_>>,
    array: Register<Array<'_>>,
    callback: Register<Function<'_>>
) -> JsResult<Register<Value<'_>>> {
    let target = target.bind(agent);
    let array = array.bind(agent);
    let callback = callback.bind(agent);
    let result = array_prototype_map(agent, array.into_value(), &[callback.into_value()])?;
    let result = result.bind(agent);
    target.push(result);
}
```

The borrow checker will yell at us again: `target` keeps the lifetime of
`&Agent` alive beyond a call that takes `&mut Agent`. This is the borrow checker
being helpful: It tells us that `target` might have gotten garbage collected or
moved during that call. What we have to do is root it before the call:

```rs
let target: Global<Value<'static>> = target.bind(agent).root(agent);
let array = array.bind(agent);
let callback = callback.bind(agent);
let result = array_prototype_map(agent, array.into_value(), &[callback.into_value()])?;
let result = result.bind(agent);
target.take(agent).push(result);
```

But if we do it like this, now we have a potential memory leak: If
`array_prototype_map` threw an error then we'd forget to `take()` the Global we
created, and it would forever stay a root in the heap. What we need is some way
to bind the `target` to a "scoped" root value.

```rs
fn do_mapping(
    scope: &Scope,
    agent: &mut Agent,
    target: Register<Array<'_>>,
    array: Register<Array<'_>>,
    callback: Register<Function<'_>>
) -> JsResult<Register<Value<'_>>> {
    let target: Local<'_, Value<'_>> = target.bind(agent).scoped_root(scope);
    let array = array.bind(agent);
    let callback = callback.bind(agent);
    let result = array_prototype_map(agent, array.into_value(), &[callback.into_value()])?;
    let result = result.bind(agent);
    target.get(agent).push(result);
}
```

This would probably work, but it's still problematic in a few ways. First, we
now have two parameters that we need to keep passing through everything. We can
probably solve that problem by just combining `scope` and `agent` into a single
`context` parameter though. The second and harder problem is that there is
nothing binding `Scope` and `Agent` together: We'd want `Scope` to know which
`Agent` it belongs to and only be "openable" using that `Agent` but this
requires adding a
[generativity](https://docs.rs/generativity/latest/generativity/) like solution,
that is it requires another lifetime parameter. This "brand" lifetime would also
need to be stamped onto `Agent` and each `Value` and its subvariant like `Array`
and `Function`. It might be possible to reuse the `'gc` lifetime for this
purpose which would make it mostly palatable:

```rs
fn example<'gc, 'brand, 'scope>(
    scope: &'scope Scope<'brand>,
    agent: &'gc mut Agent<'brand>,
    value: Register<Value<'brand>>
) -> JsResult<()> {
    let value: Value<'gc> = unsafe { value.bind(agent) };
    let local_value: Local<'scope, Value<'brand>> = value.scoped_root(scope);
    Ok(())
}
```

This is still not very pretty, even if most of the lifetime parameters can be
elided out. And how would we now combine `scope` and `agent` into a single
`context` parameter?

```rs
fn example<'gc, 'brand, 'scope>(
    context: &mut Context<'gc, 'brand, 'scope>,
    value: Register<Value<'brand>>
) -> JsResult<()> {
    // ...
}
```

I had thought this would not work: We must take `&mut Context` instead of a
shared reference to be able to exclusively use the `&mut Agent` held inside, but
now binding a `Value<'_>` to `Local<'scope, Value<'brand>>` needs to use a
`&mut Context<'gc, 'brand, 'scope>` that then "transitively" holds borrows from
inside the `&mut Context` borrow. Counter to my expectations this does
[seem to work](https://play.rust-lang.org/?version=stable&mode=debug&edition=2021&gist=441fa88fd38448917e8e199f83f4b35e)
so this does seem like a viable path forward.

## Enter Scope, man!

The question then becomes, where does the `'scope` lifetime really come from,
and what does it stand for? For now lets drop the `'brand` lifetime for
simplicity (and in hopes that we can remove it as redundant). The `'scope`
lifetime stands for a limitation of "within this scope / lifetime, a
`Local<'scope, Value<'_>>` is guaranteed to not be invalidated by garbage
collection". The way we'd do this is the above-mentioned indirection: A
`Local<'_, Value<'_>>` is an index to a Vec of Values that are accessible by the
garbage collector, meaning that during garbage collection it can both use these
Values as roots for collection but also, importantly, it can rewrite them to
repoint them if the `Value<'_>`'s data moves as part of garbage collection.

When the "scope" is exited, we want to drop this Vec of Values, or possibly we
want to shorten it to its previous length if we have multiple scopes stacked on
top of one another. There is something to be said about dropping each
`Local<'_, Value<'_>>` individually; this would mean that we have very direct
control of the depth of our stack (because this is what we're creating here).
The downside would be that each pop from the stack would need to be done with
access to the Vec which we are likely to keep inside the `Agent`, and this means
that any `Drop` impl on `Local` would be impossible as it would need to access
the `Agent` through some unknown means of context passing. Thread local storage
could solve this, but it is an ugly solution to a silly problem. No, it is
better to keep the `Local`s as flyweight handles and drop one "scope" at a time.

But dropping the scope still needs access to the `Agent`! We cannot keep a
mutable reference to it around somewhere while we're passing the `&mut Context`
around, since that likewise contains the mutable `Agent` reference. What we can
do is use actual Rust function scopes to resolve the problem:

```rs
let result: JsResult<Register<Value<'_>>> = agent.enter_scope(|ctx: &mut Context<'gc, 'scope>| {
    example(ctx, some_value)
});
```

Entering a scope through the `Agent` saves the current depth of the stack Vec to
the native stack call, and then calls the given closure with a `&mut Context`
that can be used to call into JavaScript. When this call finishes the length of
the stack Vec is reset to the saved depth, effectively dropping all
scope-allocated roots.

We need to also be able to stack scopes. This should be doable using the exact
same logic:

```rs
let result: JsResult<Register<Value<'_>>> = ctx.enter_scope(|ctx| {
    example(ctx, some_value)
});
```

This just gives us a new `ctx` with a different `'scope` lifetime. The lifetime
doesn't need to be invariant; it is perfectly okay to use a
`Local<'old_scope, Value<'_>>` from the parent `ctx` scope in the child scope.

## Off to the races?

So, is it time to go implement this? Probably... The unsafety around
`Register<T>` and having to bind them immediately after receiving is definitely
unfortunate and has generated relatively strong opposition as well. There is yet
another option, which is to cram the `this` value, all parameters and even the
return value inside the `Context`. This would make it possible to extract
properly bound `Value<'gc>` values for `this` and each parameter from the
`Context` directly. But now these would always be rooted again, which is what
the `Register<T>` system tries to avoid.

The biggest technical problem is the complexity of actually making the change:
Nova's code base is not tiny by any means at this point. Making this change
requires changing hundreds of files and tens of thousands of lines of code. And
before the changes are actually truly safe to use, the lifetimes need to be
plumbed through the _entire_ code base. This is going to take a ton of work.

Nevertheless, think this is where we are heading I think. Nova's heap is such
that we always have at least two levels of indirection from a Value to its
backing data, first through the `&mut Agent` pointer to the heap, and from there
we need to index into a `Vec<T>` to get the backing data. It seems unwise to
unconditionally add yet another level of indirection (or two) for all backing
data accesses in the form of the `Local<T>`.

At the end of all that work, we will have an interleaved garbage collector.
Without one, Nova can hardly even be used as a JavaScript engine except in very
limited (or very asynchronous) use-cases.
