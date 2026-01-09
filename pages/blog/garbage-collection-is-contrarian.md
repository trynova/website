---
title: Garbage collection is contrarian
description: Modeling unrooted handles to garbage collected data using contravariant lifetimes.
date: 2026-01-06
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Previously on this blog I've written about how Nova JavaScript engine
[models garbage collection to the Rust borrow checker](./guide-to-nova-gc) and
how to work with it, I've rambled about how I
[came up with the model](./taking-out-the-trash), and I've written about the
[philosophical underpinnings of garbage collection in general](./memory-hell).
Most importantly I have, together with a lot of contributors, written a
JavaScript engine encompassing more than 100,000 lines of Rust using this model
which is equal parts excellent and awful. It is excellent in that it manages to
explain garbage collected handles in such a way that the borrow checker will
check that unrooted handles are not used after garbage collection safepoints,
but it is awful in how it achieves this, turning code into a soup of
`let handle = handle.bind(nogc)` and `handle.unbind()` calls. A Norwegian
university employee said of the system just last month: "That's worse than C++."

In all this time I've been working with this model with the assumption that it
is the correct way to model garbage collection, and that the manual aspects and
some limitations of it are simply caused by limitations of the Rust borrow
checker. Much of this changed two days ago because I was writing a safety
comment to explain a very contrarian limitation of the system.

## Working with the garbage collected heap

A garbage collected system always has some heap structure wherein it stores the
garbage collected data. The heap will then contain garbage collected handles,
ie. self-references. Let's consider a singular handle `Handle<'_, u32>` stored
on the heap and try to figure out what is the correct lifetime that we should
ascribe to `'_`.

Because this is a garbage collected system, as long as this `Handle<'_, u32>`
exists on the heap (and is itself referenced by some root) then the `u32` is
kept alive as well. It is incorrect for the `Handle` to be alive but the `u32`
to be dead, but once the `Handle` is dropped by the garbage collector it is also
free to drop the `u32`. This also applies to moving the `u32`: conceptually we
can say that if the data is moved, then it should first be copied into a new
location, then a new `Handle<'_, u32>` should replace the old handle, and only
after that are we allowed to drop the original `u32`. (Also note how this
corresponds with eg. tombstones in concrete garbage collector implementations.)
So, if the `Handle` lives until the end of the program, then the `u32` lives
until the end of the program. It thus seems like the correct lifetime to ascribe
is `'static`.

Now, consider a singular handle `Handle<'_, u32>` on the stack, and remember
that these are unrooted handles and that our garbage collector does not do stack
scanning. That means that the `u32` is only guaranteed to exist until the next
garbage collection run: the fact that we have a `Handle<'_, u32>` in the first
place guarantees that the `u32` does exist when we get the handle, but once
garbage collection runs it might have dropped or moved the `u32` such that our
handle no longer points to a valid value. The lifetime we can ascribe to
`Handle` is thus some `'local` lifetime during which it is guaranteed that
garbage collection does not happen. This `'local` lifetime is obviously shorter
than `'static` but now here comes the contrarian part:

Imagine we get a mutable reference to the handle on the heap and try to store a
copy of our local reference in it:

```rust
let local_handle: Handle<'local, u32> = local;
let heap_mut: &mut Handle<'static, u32> = heap.get_mut();
*heap_mut = local_handle;
```

In garbage collection terms this is (basically) the act of "rooting" the local
handle: we store the local handle on the heap where the garbage collector can
see it, thus increasing its lifetime. Thus this should compile. But! If we're
doing this in the Nova JavaScript engine of today, it does not work: today we
use covariant lifetimes, equal to normal references, and using Rust references
the above would look like this:

```rust
let local_handle: &'local u32 = &0;
let heap_mut: &mut &'static u32 = heap.get_mut();
*heap_mut = local_handle;
```

This absolutely does not compile: what the code here is saying is "`heap_mut` is
place that can store any reference to a `u32` as long as that reference is valid
until the end of the program", and we try to store in it a reference that is
only valid until the end of this function call. Our reference's lifetime is too
short. So, obviously covariant lifetimes for garbage collected handles do not
work. You can probably find many articles on the Internet decrying the borrow
checker for not being able to define this. This kind of code is also what I was
writing a safety comment on two days ago. What I was doing was this:

```rust
let local_handle: Handle<'local, u32> = local;
let heap_mut: &mut Handle<'static, u32> = heap.get_mut();
// SAFETY: It is safe to shorten the lifetime of a Handle from the heap to a
// local lifetime, as making a copy of the Handle must make it 'local and
// conversely, storing a 'local Handle onto the heap makes it 'static.
let heap_mut: &mut Handle<'local, u32> = unsafe { core::mem::transmute(heap_mut) };
*heap_mut = local_handle;
```

And then it hit me: this is (lifetime) contravariance!

## Contrary thinking

Contravariance is a painful thing to try to reason about. The basic idea is in
type systems is simple: given two types `T` and `U` where `T <= U` (`T` is a
more generic than `U`, or `T` is the supertype and `U` is a subtype), a generic
type `C<X>` is contravariant if `C<T> >= C<U>` (`C<U>` is more generic than
`C<T>`, or `C<U>` is the supertype and `C<T>` is the subtype). Note how the
ordering changes!

An example of a contravariant generic type is a function taking one generic
parameter, `f<T>(T)`. If I ask you for an animal and you give me a cat, this is
okay: a cat is an animal. If I ask for a function that can be called with any
animal and you give me a function that can be called with only a cat, this is
not okay: a function that takes any cat is not a function that takes any animal.
Despite `Animal <= Cat` the order reverses in `f(Animal) >= f(Cat)`.

For lifetimes this means the following: when I ask you for a lifetime `'a`, in
the covariant case you can give me a lifetime that is equal or longer than `'a`.
Think for instance of a function taking `&'a u32`: it's okay if you call the
function with a `&'static u32` as I will simply use it as if it had a shorter
lifetime. In the contravariant case you can give me a lifetime that is equal or
_smaller_ than `'a`: to show this in Rust we use a `fn(&'a u32)`, or "give me a
function that can be called with a reference of lifetime `'a`."

Now when a function takes a `fn(&'a u32)` it means that there is some lifetime
`'a` during which all references used to call this function are valid. We can of
course call the function with a reference that is valid for longer
`&'long u32
where 'long: 'a` or `&'static u32` as that longer reference is still
valid during the `'a` lifetime. Or in other words, `&'a u32` is a subtype of
`&'long
u32`, so the supertype can be coerced into it. But we can also "get
ahead of callers" and perform this subtyping ourselves by reassigning the
function into `fn(&'long u32)` or a `fn(&'static u32)`. Note that this doesn't
mean that we require that the `'a` lifetime must become `'long` or `'static`,
instead it means that when we pass this function onwards in the future, we
(spuriously) require a longer lifetime of its parameters, which then get
shortened back down to `'a` by the function's actual contents.

A great example of this in action comes from [Boxy](https://github.com/BoxyUwU)
over in the Rust language Zulip:

```rust
static BORROW: u32 = 0;

fn foo<'a>(fnptr: fn(&'a u32)) {
    // As the caller we can shrink the lifetime of `BORROW` before passing it to
    // `fnptr` which expects a borrow of lifetime `'a`
    let local: &'a u32 = &BORROW;
    fnptr(local);

    // Alternatively we can have the function pointer itself do this for all of
    // its callers!
    let local_fnptr: fn(&'static u32) = fnptr;
    local_fnptr(&BORROW);

    // It may also be helpful to realise we can *explicitly* perform this
    // implicit subtyping by writing it as a closure
    let local_closure = |param: &'static u32| {
        let param: &'a u32 = param;
        fnptr(param);
    };
    local_closure(&BORROW);
}
```

[Rust Playground](https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&gist=740818a2a31f91810387bf15a0a44a4d)

Another way to think of contravariant types is to think of them as "sinks" that
can be used with values of a given type, but using them with supertypes is also
fine. In lifetime terms, it means that the contravariant type defines a lower
bound for a lifetime that it can be used with, but longer ones are fine as well.

Now, putting this into action with contravariant handles is where things really
get convoluted. The function example is simple enough, but let's rewrite it
using wrapper types:

```rust
static BORROW: PhantomData<&'static ()> = PhantomData;

fn foo<'a>(cov: Contravariant<'a>) {
    let local: PhantomData<&'a ()> = BORROW;
    cov.f(local);

    let local_cov: Contravariant<'static> = cov;
    local_cov.f(BORROW);

    let local_closure = |param: PhantomData<&'static ()>| {
        let param: PhantomData<&'a ()> = param;
        cov.f(param);
    };
    local_closure(BORROW);
}
```

[Rust Playground](https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&gist=19615993781251b3cbd3ca2f66517dd2)

Now that might already make your head spin! We take in a parameter
`Contravariant<'a>` but then we can use that value in place of
`Contravariant<'static>`! That is pretty odd indeed, but that's just how
contravariance works.

Now that we're dealing with contravariant marker types, we need to start
thinking about what such types really mean. To rephrase the above "sink"
interpretation, a contravariant reference is a "write-only reference". You
cannot ever read from them (safely, unconditionally) but you can write into them
for their entire lifetime. What's the point in that, then? Well, it depends on
the API built around it, but there seems to be possibilities here. The tough
part is finding how to model the proof needed to safely read through a
contravariant reference, or in other words how to as to design safe APIs around
them. Then there's the added wrinkle that we probably need one additional
feature in Rust to really make contravariant references safe to pass between
functions.

That feature is being able to pass as parameters lifetimes that do not live
until the end of the function: a contravariant reference does not itself
guarantee that the referree is valid until the end of the reference lifetime.
Thus, receiving one as a parameter to a function is rife with danger: the
reference cannot be assumed to be valid unless you have proof, it might be made
unsound to read by work within your function, yet its lifetime is the standard
Rust "until the end of this function call". In current Rust, only lifetimes that
are created within your function can also end within it. So, inside a function
we can and need to "mix" or combine the contravariant lifetime with a normal
covariant reference. This makes contravariant reference automatically invalidate
after the covariant reference invalidates, so we can design a "proof" API based
on a covariant reference. It is then also possible to pass both a contravariant
reference and its proof of validity into a function call at the same time, but
inside the function the contravariant reference's lifetime expands back into
that familiar "until the end of this function call" and is no longer bound by
that proof parameter.

This is then the problem: upon receiving a contravariant reference and a proof
parameter, you must trust whoever called you to have given you valid proof and,
importantly, _to not have made a mistake_! I'll say that again: contravariant
references as a parameter (and as a return value) require callers to not have
made a mistake! This could be called "profoundly un-Rusty". Hence why we need
the feature of passing in parameter lifetimes that end within the callee: with
that we can escape the curse of having to assume no one makes mistakes. And as
we well know, mistakes always happen.

That being said, this fundamental unsafety of contravariant references is not a
critical issue as long as you do take it into account: in Nova we do not rely on
our handles being mistake-free, which means that we always check that them for
validity before using them as offsets. As a result, a mistake with handles leads
to either a bounds check induced panic, or to one JavaScript value changing into
another one of the same type. The former is unfortunate but safe, the latter is
absolutely a bad thing to happen and likely breaks the JavaScript code's
assumptions but should generally be mostly safe. If need be the latter can also
be checked against using generational handles: we luckily also have 24 unused
bits in heap handles that we could use for that purpose.

## On the double? On the contrary!

It's time to start thinking about what this means in terms of the Nova
JavaScript engine. It is clear that contravariant handles is what we will have:
they match the actual semantics of garbage collection, and their big unsafety
downside is something that we already currently deal with. So while I have some
more stones to turn and tires to kick before I'm fully ready to commit, it does
seem like Nova's JavaScript Values are in for a big change! There are some
excellent things that come from this change, first and foremost being that a lot
of the `.unbind()` and `.bind(gc.nogc())` calls of the engine will disappear.
Let's take an example from the engine's code:

```rust
pub(crate) fn set<'a>(
    agent: &mut Agent,
    o: Object,
    p: PropertyKey,
    v: Value,
    throw: bool,
    mut gc: GcScope<'a, '_>,
) -> JsResult<'a, ()> {
    let nogc = gc.nogc();
    let o = o.bind(nogc);
    let p = p.bind(nogc);
    let v = v.bind(nogc);
    let scoped_p = p.scope(agent, nogc);
    let success = o
        .unbind()
        .internal_set(agent, p.unbind(), v.unbind(), o.unbind().into(), gc.reborrow())
        .unbind()?;
    let gc = gc.into_nogc();
    let p = scoped_p.get(agent).bind(gc);
    if !success && throw {
        return throw_set_error(agent, p, gc).into();
    }
    Ok(())
}
```

This is the function used to set a value on an object, triggered whenever we
call `o.p = v` or `o[p] = v`. It is a flawless piece of Nova engine code that is
both fully GC safe and also written such that the borrow checker will verify
that GC safety: every handle parameter is bound to the GC lifetime at function
entry, and the `PropertyValue<'static>` received from the `scoped_p.get(agent)`
call is likewise properly bound. Unfortunately, this flawlessness comes at a
price of requiring 7 `.unbind()` calls. Here's what it would look like with
contravariant lifetimes:

```rust
pub(crate) fn set<'a>(
    agent: &mut Agent,
    o: Object,
    p: PropertyKey,
    v: Value,
    throw: bool,
    mut gc: GcScope<'a>,
) -> JsResult<'a, ()> {
    let nogc = gc.nogc();
    let o = o.local();
    nogc.join(o);
    let p = p.local();
    nogc.join(p);
    let v = v.local();
    nogc.join(v);
    let scoped_p = p.scope(agent, nogc);
    let success = o.internal_set(agent, p, v, o.into(), gc.reborrow())?;
    let gc = gc.into_nogc();
    let p = scoped_p.get(agent);
    gc.join(p);
    if !success && throw {
        return Err(throw_set_error(agent, p, gc));
    }
    Ok(())
}
```

The most important change here is the actual `internal_set` call: the
`.unbind()` and `.bind(gc.nogc())` calls have all disappeared. Especially
important from an ergonomics standpoint is that we can now re-throw errors using
the `?` operator without having to do the chain of `.unbind()?.bind(gc.nogc())`.
There are nearly 800 places in the Nova codebase that perform this song and
dance currently, and getting rid of them will probably bring a smile to many a
contributor's face.

But we do lose some convenience as well: binding parameters is no longer just
`let o = o.bind(nogc);` but instead requires two calls. First is the
`let o = o.local();` call: this replaces the parameter handle that has the
problematic "until the end of this function call" lifetime with a local handle
whose lifetime we can force to end within this function. The second is the
`nogc.join(o);` call: this "mixes" or combines the lifetime of the the
contravariant handle with the covariant lifetime of a local `&Gc<'_>` reference
used in the `gc.nogc()` call. In essence I think this is like us writing
`Gc<'_>` into our "sink". When we then create a local `&mut Gc<'_>` reference in
the `gc.reborrow()` call, it invalidates the `Gc<'_>` that we wrote into our
"sink". This leads to the handle invalidating but only after the `internal_set`
call ends, allowing us to still pass the handles as parameters.

Being able to thus pass "bound" handles into calls together with the `Gc<'_>`
marker trait is such an important thing that the loss of some binding
convenience is small potatoes in comparison. Much of the convenience can be
regained using a simple macro anyway.

## Thinking bigger

I hope I've managed to convince you that garbage collected handles are indeed
lifetime contravariant, and that contravariant references are not merely a bug
in the Rust lifetime system but an actual thing that can be ascribed a meaning
of some sort. I also expect I've not managed to make a very strong or concise
case as to what that meaning is, as I frankly do not yet know it myself either.
The lifetime contravariance of garbage collected handles does give us a hint,
though: garbage collection is generally applied upon cyclical structures.

I believe, quite strongly yet without proof, that contravariant references have
a part to play in describing self-referential data structures in Rust in
general. What kind of a part that will be and what their role will be I do not
yet know, but it seems clear to me that with the right API designs contravariant
references can bring the joy of lifetimes to many avenues where they previously
were barred from. Either that, or I am being a total crackpot. I guess time and
effort will tell!

Until then, stay contrary!
