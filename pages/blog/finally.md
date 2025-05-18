---
title: Finally - doubling the odds
description: A story of perseverance and the finally keyword.
date: 2025-05-17
authors:
  - name: Aapo Alasuutari
    url: https://github.com/aapoalas
---

Last week, I took up the challenge of implementing JavaScript's `finally`
keyword in Nova's bytecode compiler and interpreter. As part of that work, I
wanted to solve closing of iterators in `for-of` loops when control flow
abruptly leaves the loop, as this feature has a strong resemblance to the
`finally` keyword's mechanisms.

This is a story of how I found a solution that satisfied me and allowed me to
keep my sanity, or whatever is left of it.

## What is `finally`?

The `finally` keyword is part of the `try-catch` error handling construct, which
allows code to be run unconditionally no matter how control flow leaves the
`try` block. For instance, the following code will always log "finally" once:

```js
const randomInt = (max) => Math.floor(max * Math.random());
loop: do {
  try {
    switch (randomInt(6)) {
      case 0:
        break loop;
      case 1:
        continue loop;
      case 2:
        return 0;
      case 4:
        throw new Error("error 0");
      case 5: {
        // fallthrough
      }
    }
  } catch (_error) {
    switch (randomInt(6)) {
      case 0:
        break loop;
      case 1:
        continue loop;
      case 2:
        return 1;
      case 4:
        throw new Error("error 1");
      case 5: {
        // fallthrough
      }
    }
  } finally {
    console.log("Finally");
    switch (randomInt(6)) {
      case 0:
        break loop;
      case 1:
        continue loop;
      case 2:
        return 2;
      case 4:
        throw new Error("error 2");
      case 5: {
        // fallthrough
      }
    }
  }
} while (false);
```

The code also highlights a peculiar speciality of `finally` blocks: it can
contain control flow statements ie. `break`, `continue`, `return`, and `throw`.
So how does the control flow through a finally block actually work? Let's
simplify the example a little.

```js
try {
  switch (randomInt(6)) {
    case 0:
      break loop;
    case 1:
      continue loop;
    case 2:
      return 0;
    case 4:
      throw new Error("error 0");
    case 5: {
      // fallthrough
    }
  }
} finally {
  console.log("Finally");
}
```

There are now 5 different ways for us to exit the `try` block; we either break
out of it, continue out of it, return out of it, throw out of it, or exit
normally out of it. In each case the `finally` block must be visited as the exit
happens, and when the `finally` block is exited we must return to the control
flow we entered it with. This means that if we came from the `break loop;`
statement then we must continue onwards with a `break` "completion", if we came
from the `return;` statement then we must continue onwards with a `return`
"completion" and so on.

So, a `finally` block can be entered in many ways, it can itself contain control
flow statements that change the control flow, and if it doesn't change it then
exiting the `finally` block must recall what sort of control flow it was entered
with and continue with that. Sounds a bit complicated, but whatever, let's loop
back to this in a bit.

## Iterating on the idea

So how are `for-of` loops connected with `finally`? Basically, `for-of` loops
have an implied `finally` block that calls the `return` method of the iterator
that the loop interacts with. This means that in very rough terms, the following
loops are identical:

```js
const array = [1, 2, 3, 4, 5];
for (const x of array) {
  doWork(x);
}

{
  const iterator = array[Symbol.iterator]();
  let done = false;
  try {
    while (true) {
      const result = iterator.next();
      if (result.done) {
        done = true;
        break;
      }
      const x = result.value;
      doWork(x);
    }
  } finally {
    if (!done) {
      iterator.return?.();
    }
  }
}
```

There are a few extra wrinkles that should be added to make the two fully equal,
but this is good enough to show how `for-of` loops and `finally` blocks connect:
when control flow abruptly exits a `for-of` loop, it must call the iterator's
`return` method to signal to the iterator that it should close down.

## Implementing control flow

How do we implement a `finally` block then? The most direct way from looking at
the code, and perhaps even from a basic block -based compiler implementation
point of view, would be to compile the `try` block's contents with the knowledge
that any control flow must enter the `finally` block, and compiling the
`finally` block such that it can be entered with any kind of control flow.

So our above simplified example would roughly become something like this:

```js
// try block
let completionType;
let completionValue;
switch (randomInt(6)) {
  case 0: {
    completionType = "break";
    break;
  }
  case 1: {
    completionType = "continue";
    break;
  }
  case 2: {
    completionType = "return";
    completionValue = 0;
    break;
  }
  case 4: {
    completionType = "throw";
    completionValue = new Error("error 0");
    break;
  }
  case 5: {
    completionType = "normal";
    break;
  }
}
// finally block
console.log("Finally");
switch (completionType) {
  case "break":
    break loop;
  case "continue":
    continue loop;
  case "return":
    return completionValue;
  case "throw":
    throw completionValue;
  case "normal": {
    // fallthrough
  }
}
```

Now, this might look a bit familiar: our "finally block" now contains
effectively the same `switch` case that our `try` block originally had, and this
is not really a coincidence: since the `finally` block must be exited with
whatever we entered it with (unless the `finally` block changes our control
flow), it stands to reason we'd end up reproducing the same kind of switch case
as we originally had.

But what if there's a higher-level `try-finally` statement around our `finally`
block?

### Recursion!

If a higher-level `try-finally` statement is present, then we'd need to store
the completion type that we exit our `finally` block with in a variable so that
the higher level `finally` block can read it and choose how to eventually exit
itself. And since we know we don't need our `completionType` and
`completionValue` variables after this scope here, we could just as well pull
those to the top level of the script or function.

In an interpreter, these sorts of "top-level variables" are often called
"registers". Our interpreter would then need at least the following:

- A "completion value" or "result" register.
- A "completion type" register.
- A "completion target" register, needed for telling apart `break;`,
  `break loop;`, and `break loop2;` statements.

But the vast majority of time the only we'd only use the "result" register; the
others would only really be used when exiting `finally` blocks, when exiting
loop and switch statements, or when checking for throw results. Effectively,
they would be registers for handling control flow. Keeping two whole registers
(regardless of their size) for that seems wasteful, especially since a lot of
the checks can be done at compile-time and we already need an "instruction
pointer" register that is used for performing normal control flow.

### Compile-time control flow

For `break`, `continue`, and `return` statements the necessary logic for
understanding their control flow is very simple: it is only just barely more
than drawing straight lines in the code. We can calculate these control flows
very easily at compile-time, and without `finally` blocks they require nothing
more than possibly exiting lexical scopes, and performing a jump instructions,
ie. changing the "instruction pointer" register's value.

For thrown errors the control flow is more complex, as nearly every statement
and expression in JavaScript can throw arbitrary errors. But the exit condition
for thrown errors is very simple: either the error is propagated all the way to
the top, or it is caught by a `catch` block on the way there. Finding
`try-catch` blocks is again very simple, so tracking where error control flow
goes is fairly simple at compile-time. What is not simple is tracking where error control flow
comes from, so it is often an easier choice to make catch handling happen at
runtime.

This means that we can track breaks, continues, returns, and the location of `try-catch`
blocks at compile-time. Throwing of errors is easier to do at runtime, and when
an error is thrown we'll simply jump to the current `catch` block and reset the lexical
scope to what it was when the corresponding `try` block was entered. But how do we then
slot `finally` into the system?

## Polymorphic `finally`

Going with the original idea, we could make `finally` blocks be "polymorphic" in that
we'd track them at compile-time and make any kind of entry into them, a normal
control flow, `return` statement, `break` statement, `break foo` statement, thrown error, ..., jump into the block at a different location.
Each entry location would then store its own "completion type" and "completion value" as a JavaScript value into the interpreter's state as a temporary value (Nova's interpreter is
a stack-based interpreter, so they'd be pushed onto the stack). Then, when control flow is
about to exit the `finally` block these values would be retrieved from their temporary storage
and effectively switch case with the value would be entered.

I call this a "polymorphic" `finally` block, as the block exists as a singular entity but it
can handle different kinds of completion types at runtime, using if-statements (dynamic dispatch)
to determine how it eventually exits the block.

This is technically a fine choice, but I did not find it to my liking: for one, in a stack based
interpreter this would mean that any `return`, `break`, or `continue` statements inside the
`finally` block would require separate handling as they would likewise have to retrieve the
stored values from the stack before continuing their control flow. Without this, the
stack would slowly keep growing over time in these constructs, leaking memory.

Second, I disliked the idea of using JavaScript values as control flow primitives of the engine.
It simply did not feel elegant; I do not want to switch on a JavaScript number `1` to find
that a `finally` block was entered with a thrown error. Doing so simply felt wrong to me.
Yet I also did not want to add the extra registers into the interpreter just so that `finally`
blocks would work.

At this point, I started looking for prior art and opinions. This turned out to be a great
idea, as when I asked in Ladybird Browser's Discord server for how their LibJS engine implements `finally` control flow,
I had the idea of implementing "monomorphic" `finally` blocks. The idea seemed like it might
be a really good or bad idea, so I asked for opinions on this in the Coffee Compiler Club Discord
and found to my delight that I was not at all the first one to have this idea (which is not a
surprise, I am hardly an original thinker) but better yet, that this was actually deemed a good
enough idea to make it into various Java virtual machines!

So, what are "monomorphic" `finally` blocks?

## Monomorphic `finally`

The basic idea is simple: if adding registers is not to my liking, and using JavaScript values
injected by the compiler is not my cup of tea either, then how about adding extra `finally` blocks? This will duplicate code but it is simple, requires no additional registers or injecting
JavaScript values and control flow based on them, and likewise requires no special tracking of
`break`, `continue`, or `return` statements inside of `finally` blocks.

Looking at the simplified example from earlier, the end result roughly becomes this:

```js
try {
  switch (randomInt(6)) {
    case 0:
      console.log("Finally");
      break loop;
    case 1:
      console.log("Finally");
      continue loop;
    case 2:
      console.log("Finally");
      return 0;
    case 4:
      throw new Error("error 0");
    case 5: {
      // fallthrough
    }
  }
  console.log("Finally");
} catch(err) {
  console.log("Finally");
  throw err;
}
```

As you can see, the contents of the `finally` block have traveled up to where
the control flow starts at, except for the error case which is handled at runtime,
and hence the `finally` block contents has entered the implied "catch and rethrow" block
of the `try-catch`.

This system can also be called "inlining" of `finally` blocks, though in actual reality
I did not quite inline them at the control flow sites, but instead placed all of the
different required `finally` block variations at the site of the `try-(catch)-finally` block
and simply made control flows jump into their correct variation. If JavaScript had the forbidden and spicy `goto` keyword then we could write the actual result like this:

```js
try {
  switch (randomInt(6)) {
    case 0:
      console.log("Finally");
      goto break_loop;
    case 1:
      console.log("Finally");
      goto continue_loop;
    case 2:
      console.log("Finally");
      result = 0;
      goto return;
    case 4:
      throw new Error("error 0");
    case 5: {
      // fallthrough
    }
  }
  goto normal;
} catch(err) {
  console.log("Finally");
  throw err;
}
break_loop: {
  console.log("Finally");
  break loop;
}
continue_loop: {
  console.log("Finally");
  continue loop;
}
return: {
  console.log("Finally");
  return result;
}
normal: {
  console.log("Finally");
}
```

Does this seem insane to you? It may well seem insane. But there is some real benefit here:
the logic for generating this bytecode is fairly simple, and the work can be done
at compile-time with a "one-time only" cost. The code duplication seems
bad, but `finally` blocks are rarely very big, and they rarely contain multiple types of
control flow statements, or ones targeting different loops from one another.
In real code, the duplication should mostly be limited to the normal and throw completion
paths, and perhaps a third path like a return coming from inside the `try` block.

But the simplicity of the solution makes up for the downsides, at least for now.

### The optional solution...?

Here's how the solution works: during compilation from AST to bytecode, we keep a
"stack" of scoped runtime structures. These are things like lexical scopes,
loops, switch statements, and `finally` blocks. When such a structure is entered, an entry
is added to the stack together with lists of incoming abrupt, non-throw control flow.

When the structure is exited, the entry is popped from the stack and its teardown instructions
iare inserted into the bytecode, such as exiting a lexical scope or changing the current catch-block location. This takes care of the simple cases, but what about visiting `finally` blocks when control flow abruptly leaves the `try-catch` block?

This is done such that
