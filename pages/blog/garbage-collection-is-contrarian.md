---
title: Garbage collection is contrarian
description: Modeling unrooted handles to garbage collected data using contravariant lifetimes.
date: 2026-01-09
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Previously on this blog I've written about how Nova JavaScript engine
[models garbage collection using the Rust borrow checker](./guide-to-nova-gc)
and how to work with it, I've rambled about how I
[came up with the model](./taking-out-the-trash), and I've written about the
[philosophical underpinnings of garbage collection in general](./memory-hell).
Most importantly I have, together with a lot of contributors, written a
JavaScript engine encompassing more than 100,000 lines of Rust using this model
which is equal parts excellent and awful. It is excellent in that it manages to
explain garbage collected handles in such a way that the borrow checker can
check that unrooted handles are not kept on stack past garbage collection
safepoints, but it is awful in how it achieves this, turning code into a soup of
`let handle =
handle.bind(nogc)` and `handle.unbind()` calls. A Norwegian
university employee said of the system just last month: "That's worse than C++."

This entire time, I've been working with this model with the assumption that it
is the correct way to model garbage collection, and that the manual aspects and
some limitations of it are simply caused by limitations of the Rust borrow
checker. Much of this changed last weekend because I was writing a safety
comment to explain a very contrarian limitation of the system.

## Working with a garbage collected heap

A garbage collected system always has some heap structure wherein it stores the
garbage collected data. The heap will then contain garbage collected handles,
ie. self-references. Let's consider a singular handle `Handle<'_, T>` stored on
the heap and try to figure out what is the correct lifetime that we should
ascribe to `'_`.

Because this is a garbage collected system, as long as this `Handle<'_, T>`
exists on the heap (and is itself reachable from some root) then the `T` is kept
alive as well. It is incorrect for the `Handle` to be alive but the `T` to be
dead, but once the `Handle` is dropped by the garbage collector it is also free
to drop the `T`. This also applies to moving the `T`: conceptually we can say
that if the data is moved, then it should first be copied into a new location,
then a new `Handle<'_, T>` should replace the old handle, and only after that
are we allowed to drop the original `T`. (Also note how this relates with eg.
tombstones in concrete garbage collector implementations.) When the heap is
dropped, all `Handle`s within are likewise dropped, but if the heap stays alive
until the end of the program then so do the `Handle`s. It thus seems like the
correct lifetime is some `'external` that is determined by the heap's owner, but
for convenience's sake we'll choose to use the `'static` lifetime here.

Now, consider a singular handle `Handle<'_, T>` on the stack, and remember that
these are unrooted handles and that our garbage collector does not do stack
scanning. That means that the `T` is only guaranteed to exist until the next
garbage collection run: the fact that we have a `Handle<'_, T>` in the first
place means that the `T` should at least exist when we get the handle, but once
garbage collection runs it might have dropped or moved the `T` such that our
handle no longer points to a valid value. The lifetime we can ascribe to
`Handle` is thus some `'local` lifetime during which it is guaranteed that
garbage collection does not happen. This `'local` lifetime is obviously shorter
than `'static`. Now imagine we get a mutable reference to the handle on the heap
and try to write a copy of our local handle into it, and watch what happens:

```rust
let local_handle: Handle<'local, T> = local;
let heap_mut: &mut Handle<'static, T> = heap.get_mut();
*heap_mut = local_handle;
```

In garbage collection terms this is (basically) the act of "rooting" the local
handle: we store the local handle on the heap where the garbage collector can
see it, thus increasing its lifetime. This code is therefore completely fine
from a logical standpoint. But! If we do this in the Nova JavaScript engine of
today, it does not compile: our handles are covariant on their lifetime
parameter, just like normal references, and using Rust references the above
would look like this:

```rust
let local_handle: &'local T = &0;
let heap_mut: &mut &'static T = heap.get_mut();
*heap_mut = local_handle;
```

This absolutely does not and should not compile: what the code here is saying is
"`heap_mut` is a place that can store a reference to a `T` as long as that
reference is valid until the end of the program", but we're trying to store a
reference that is only valid until the end of this function call. Our
reference's lifetime is too short, and allowing the code to compile would lead
to use-after-free. So, obviously covariant lifetimes for garbage collected
handles do not work. You can probably find many articles on the Internet
decrying the borrow checker for not allowing this, but it is absolutely correct
to stop us from doing use-after-free here. Yet, for garbage collected handles
this is what we want to do and to do that we must turn to unsafe Rust. This is
the kind of code that I was writing a safety comment on last weekend. Boiled
down to its essentials, it looked much like this:

```rust
let local_handle: Handle<'local, T> = local;
let heap_mut: &mut Handle<'static, T> = heap.get_mut();
// SAFETY: It is safe to shorten the lifetime of a Handle from the heap to a
// local lifetime, as making a copy of the Handle must make it 'local and
// conversely, storing a 'local Handle onto the heap makes it 'static.
let heap_mut: &mut Handle<'local, T> = unsafe { core::mem::transmute(heap_mut) };
*heap_mut = local_handle;
```

And then it hit me: this is (lifetime) contravariance!

## Contrary thinking

Contravariant lifetimes are a painful thing to try to reason about. The basic
idea of contravariance in type systems is simple enough: given two types `T` and
`U` where `T ≤ U` (`T` is more specific than `U`, or `T` is a subtype of the
supertype `U`), a generic type `C<X>` is contravariant if `C<U> ≤ C<T>` (`C<U>`
is more specific than `C<T>`, or `C<U>` is a subtype of the supertype `C<T>`).
Note how the order reverses!

An example of a contravariant generic type is a function taking one generic
parameter, `f<T>(T)`. If I ask you for an animal and you give me a cat, this is
okay: a cat is a subtype of animal. If I ask for a function that can be called
with any animal and you give me a function that can be called with only cats,
this is not okay: a function that takes any cat is not a subtype of a function
that takes any animal. Despite `Cat ≤ Animal` the order reverses in
`f(Animal) ≤ f(Cat)`.

For lifetimes this means the following: when I ask you for a lifetime `'a`, in
the covariant case you can give me a lifetime that is equal or longer than `'a`.
Think for instance of a function taking `&'a T`: it's okay if you call the
function with a `&'static T` as I will simply use it as if it had a shorter
lifetime. In the contravariant case you can give me a lifetime that is equal or
_smaller_ than `'a`: to show this in Rust we use a `fn(&'a T)`, or "give me a
function that can be called with a reference of lifetime `'a`."

Now when a function takes a `fn(&'a T)` it means that there is some lifetime
`'a` during which this function can be called. The function can of course be
called with references that are valid for longer (as long as that longer
reference is still valid during at least part of the `'a` lifetime). But as we
hold the function, we can also "get ahead of callers" and expand the lifetime we
require of callers ourselves. We do this by reassigning the function into some
place with the type `fn(&'static T)` (alternatively use some other lifetime
`'external` longer than `'a`), ie. we assign a complex type (function taking one
reference as a parameter) with a shorter lifetime parameter `'a` in place of a
complex type with a longer lifetime parameter `'static`. Note that this doesn't
mean that we expand the `'a` lifetime to `'static`, it just means that we can
use a complex type with a shorter lifetime in place of one with a longer
lifetime. In function parameter terms, we (spuriously) require a longer lifetime
of callers, while the function internally still considers all parameters to have
the shorter lifetime `'a`.

A great example of this in action comes from [Boxy](https://github.com/BoxyUwU)
over in the Rust language Zulip:

```rust
static BORROW: T = 0;

fn foo<'a>(fnptr: fn(&'a T)) {
    // As the caller we can shrink the lifetime of `BORROW` before passing it to
    // `fnptr` which expects a borrow of lifetime `'a`
    let local: &'a T = &BORROW;
    fnptr(local);

    // Alternatively we can have the function pointer itself do this for all of
    // its callers!
    let local_fnptr: fn(&'static T) = fnptr;
    local_fnptr(&BORROW);

    // It may also be helpful to realise we can *explicitly* perform this
    // implicit subtyping by writing it as a closure
    let local_closure = |param: &'static T| {
        let param: &'a T = param;
        fnptr(param);
    };
    local_closure(&BORROW);
}
```

[Rust Playground](https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&gist=740818a2a31f91810387bf15a0a44a4d)

Now, putting this into action with custom contravariant lifetime types is where
things really start to get convoluted. The function example is simple enough,
but let's rewrite it using custom types:

```rust
static BORROW: &'static T = &T::new();

fn foo<'a>(cov: Contravariant<'a, T>) {
    let local: &'a T = BORROW;
    cov.f(local);

    let local_cov: Contravariant<'static, T> = cov;
    local_cov.f(BORROW);

    let local_closure = |param: &'static T| {
        let param: &'a T = param;
        cov.f(param);
    };
    local_closure(BORROW);
}
```

[Rust Playground](https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&gist=19615993781251b3cbd3ca2f66517dd2)

Now that might already make your head spin! We take in a parameter
`Contravariant<'a, T>` but then we can use that value in place of
`Contravariant<'static, T>`! That looks pretty odd indeed, but that's just
contravariance for you.

Now that we're dealing with contravariant reference types, we need to think
about they really mean. To help with that, let's introduce another way of
thinking about contravariance: contravariant types can be interpreted as "sinks"
into which a type or its subtype can be dumped into, never to return. This hints
to us that a contravariant reference is a "write-only reference". You can never
safely and unconditionally read from them but you can write into them for their
entire lifetime. What's the point in that, then? Well, it depends on the API
built around it, but there are possibilities here. An example of a familiar
write-only type is the good old `MaybeUninit`, but even that is not write-only
forever but only until you're sure it is safe to read. So too it goes with
contravariant references: they can only be written into until you're sure it is
safe to read from it as well. The tough part is then finding how to model the
proof needed to safely read through a contravariant reference, or in other words
how to design safe APIs around them.

There is an added wrinkle to this: we probably need a new feature in Rust to
make contravariant references safe to pass between functions. That feature is
lifetimes that do not live until the end of the callee function: a contravariant
reference by itself does not guarantee that it is safe to read through it. Thus,
receiving one as a parameter to a function is rife with danger: the reference
cannot be assumed to be valid unless you have proof and it might be made unsound
to read from by work done within your own function, yet its lifetime is the
standard Rust "until the end of this function call" lifetime parameter and that
helps us none when trying to write safe code.

In current Rust, only lifetimes that are created within your function can also
end within it. So, inside a function we can create a contravariant reference and
then "mix" or combine its lifetime with a normal covariant reference. This makes
the contravariant reference automatically invalidate after the covariant
reference invalidates: this can be used to design a safe API based around mixing
contravariant references with a covariant reference to a proof value. Unlike
with normal covariant references, it is then possible to pass both the
contravariant reference and the "mixed in" proof value (not by reference but by
value!) into a function call at the same time, enabling transfer of the proof.
But in current Rust, inside the function the contravariant reference's lifetime
expands back into that familiar "until the end of this function call" and is no
longer bound by that proof parameter, so this safe API does not work at function
interfaces today.

This is then the problem: upon receiving a contravariant reference and a proof
parameter, you must trust whoever called you to have given you valid proof and,
importantly, _to not have made a mistake_! I'll say that again: contravariant
references as a parameter (and as a return value too) require callers (or
callees) to not have made a mistake! This has been called "profoundly un-Rusty",
and that's not wrong to say as this completely wrecks the idea of local
reasoning that is so fundamental to Rust's excellence. Hence the need for
passing in parameter lifetimes that end within the callee: with that we could
(somehow) pass the contravariant reference in with its lifetime bound to the
proof value's existence, and that would then enable us to escape the curse of
having to assume no one makes mistakes. As we well know, mistakes always happen.

That being said, this fundamental unsafety of contravariant references is not a
blocker as long as you take it into account: in Nova we do not rely on our
handles being mistake-free, which means that we always check their validity
before using them for reads. A mistake with handles then leads to either a
bounds check induced panic, or to one JavaScript value changing into another one
of the same type. The former is unfortunate but safe, the latter is absolutely a
bad thing to happen and constitutes JavaScript language-wise "undefined
behaviour": at worst this could be utilised as an attack vector against a
JavaScript runtime running Nova, so this is not a good thing generally, but it
is also not an immediate guarantee of Rust undefined behaviour happening and
leading to the end of all that is pure and holy. If need be, we can also check
against this using generational handles: we luckily also have 24 unused bits in
heap handles that we could use for that purpose.

## On the double? On the contrary!

It's time to start thinking about what this concretely means for the Nova
JavaScript engine. It is clear that contravariant handles is what we will have:
they match the actual semantics of garbage collection, and their big unsafety
downside is something that we already have to deal with. So while I have some
more stones to turn and tires to kick before I'm fully ready to start working,
it does seem like Nova's JavaScript Values are in for a big change in the near
future! There are some excellent things that come from this change. Let's take
an example; this is some code from the engine today:

```rust
pub(crate) fn set<'a>(
    agent: &mut Agent,
    o: Object,
    p: PropertyKey,
    v: Value,
    throw: bool,
    mut gc: GcScope<'a, '_>,
) -> JsResult<'a, ()> {
    // By convention, always bind all parameters at function entry for safety.
    let nogc = gc.nogc();
    let o = o.bind(nogc);
    let p = p.bind(nogc);
    let v = v.bind(nogc);
    
    // Scope p for use after possible garbage collection safepoint.
    let scoped_p = p.scope(agent, nogc);
    
    // Actual function work starts.
    let success = o
        .unbind()
        .internal_set(agent, p.unbind(), v.unbind(), o.unbind().into(), gc.reborrow())
        .unbind()?;
    
    // Transition to a proven "no GC past this point" regime.
    let gc = gc.into_nogc();
    if !success && throw {
        let p = scoped_p.get(agent).bind(gc);
        return throw_set_error(agent, p, gc).into();
    }
    Ok(())
}

/// The unbind() and bind() functions come from this trait.
unsafe trait Bindable {
    /// This is always Self<'a>;
    type Of<'a>;
    
    fn unbind(self) -> Self::Of<'static>;
    fn bind<'a>(self, gc: NoGcScope<'a, '_>) -> Self::Of<'a>;
}
```

This is the function used to set a value on an object, triggered whenever
JavaScript code performs `o.p = v;` or `o[p] = v;`. It is a "flawless" piece of
Nova engine code in that it is both fully correct from the garbage collector's
standpoint and also written so that the borrow checker will verify the GC
safety: every handle parameter is bound to the GC lifetime at function entry,
and so is the `PropertyValue<'static>` returned from the `scoped_p.get(agent)`
call even though at that point we're already past a `let gc = gc.into_nogc();`
call which is proof that there are no more garbage collection safepoints within
the function. Unfortunately, this flawlessness comes at the price of 7
`.unbind()` calls. These are necessary because each handle carries a shared
covariant reference to the `Gc` parameter and these invalidate when
`gc.reborrow()` is called while their covariant lifetime requires them to stay
valid until the end of the `internal_set` call or longer, which they cannot do:
hence the handles must be unbound at function call interfaces so that they
forget the covariant reference.

So, what would this look like with contravariant handles? Let's take a look:

```rust
pub(crate) fn set<'a>(
    agent: &mut Agent,
    o: Object,
    p: PropertyKey,
    v: Value,
    throw: bool,
    mut gc: GcScope<'a>,
) -> JsResult<'a, ()> {
    // We should still "bind" all parameters at function entry for safety.
    let nogc = gc.nogc();
    let o = o.local();
    nogc.join(o);
    let p = p.local();
    nogc.join(p);
    let v = v.local();
    nogc.join(v);
    
    // We still have to scope p.
    let scoped_p = p.scope(agent, nogc);
    
    // Actual function work starts.
    let success = o.internal_set(agent, p, v, o.into(), gc.reborrow())?;
    
    // It's still useful to mark "no GC" regimes explicitly.
    let gc = gc.into_nogc();
    if !success && throw {
        let p = scoped_p.get(agent);
        gc.join(p);
        return Err(throw_set_error(agent, p, gc));
    }
    Ok(())
}

/// Helper functions
trait Handle {
    /// This is always Self<'a>;
    type Of<'a>;
    
    /// Create a local copy of Self: note that for contravariant lifetimes this
    /// is fundamentally an unsafe operation.
    fn local<'a>(&'a self) -> Self::Of<'a>;
}

impl<'gc, 'scope> GcScope<'gc, 'scope> {
    /// Join a handle's lifetime together with a shared borrow of the
    /// (guaranteed unique) GcScope.
    #[inline(always)]
    fn join<'a, T: Handle>(&'a self, handle: T::Of<'a>) {}
}

impl<'gc, 'scope> NoGcScope<'gc, 'scope> {
    /// Join a handle's lifetime together with the GC lifetime of a GcScope.
    /// Note that NoGcScope is a Copy type created from a shared borrow of the
    /// (guaranteed unique) GcScope, meaning that this joins the handle's
    /// lifetime together with a shared borrow of that GcScope.
    #[inline(always)]
    fn join<T: Handle>(self, handle: T::Of<'gc>) {}
}
```

The most important change here is the actual `internal_set` call: the
`.unbind()` and `.bind(gc.nogc())` calls have all disappeared. Especially
important from an ergonomics standpoint is that we can now re-throw errors using
the `?` operator without having to do the chain of `.unbind()?.bind(gc.nogc())`.
There are nearly 800 places in the Nova codebase where this song and dance is
performed currently, and getting rid of that will probably bring a smile to many
a contributor's face.

But we do lose some convenience as well: binding parameters is no longer just
`let o = o.bind(nogc);` but instead requires two calls. First is the
`let o = o.local();` call: this shadows the handle (parameter that has the
problematic "until the end of this function call" lifetime) with a locally
created handle whose lifetime will end within this function. The second is the
`nogc.join(o);` call: this "mixes" or combines the lifetime of the the
contravariant handle with the covariant lifetime of a local `&Gc` reference used
in the `gc.nogc()` call. (You can also consider this to be the point when we
write a valid value into our "sink" and thus prove to ourselves that it is safe
to read from the normally write-only reference.) When we then create a local
`&mut Gc` reference in the `gc.reborrow()` call, it invalidates the `&Gc`
reference that our handle's lifetime is mixed up with which then invalidates the
handles. Importantly, however, for contravariant references a shorter lifetime
can be used in place of a longer one: this means that the handles that we pass
to the `internal_set` as parameters just before the `gc.reborrow()` call (which
is conveniently the last parameter and thus last to be evaluated for essentially
this very reason), can safely be used in place of the function's parameters with
the lifetime of "until the end of this call". And because this does not expand
the `&Gc` reference lifetime to encompass until the end of the `internal_set`
(just like using a `&'static T` in place of a `&'a T` does not expand `'a` to
`'static`), the invalidation does not invalidate the already passed-in
contravariant handles.

Being able to thus pass "bound" handles into calls together with the `Gc<'_>`
marker type is such an important thing that the loss of some binding convenience
is small potatoes in comparison. Much of the convenience can be regained using a
simple macro anyway.

## Thinking bigger

I hope I've managed to convince you that garbage collected handles are indeed
lifetime contravariant, and that contravariant references are not merely a bug
in the Rust lifetime system but an actual thing that can be ascribed a meaning
of some sort. I also expect I've not managed to make a very strong or concise
case as to what that meaning is, as I frankly do not yet know it myself either.
The lifetime contravariance of garbage collected handles does give us a hint,
though: garbage collection is generally applied upon cyclical structures.

I believe, quite strongly yet without proof, that contravariant references have
a part to play in describing self-referential data structures in general. What
kind of a part that will be and what their role will be I do not yet know, but
it seems clear to me that with the right API designs contravariant references
can bring the joy of lifetimes to many avenues where they previously were barred
from. If you're interested, I recommend trying out writing a doubly-linked list
using contravariant references in place of node pointers, or seeing what it
would look like to pass an `'external` lifetime through a self-referential data
structure that internally binds to contravariant references. Especially
interesting would be seeing if that lifetime can also be threaded back through,
so that some callback API coming from the data structure back to the owner could
benefit from contravariant lifetimes joining the two together.

I expect it might bring some surprising and positive results! Either that, or I
am being a total crackpot. I guess time and effort will tell. Until then, stay
contrary!
