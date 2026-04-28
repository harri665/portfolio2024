---
title: Hello World
date: '2026-04-27'
tags:
  - meta
  - intro
description: >-
  The first post — a quick tour of everything this blog supports: wiki links,
  callouts, images, code, and more.
published: true
---

Welcome to the blog. This post is a reference for every feature supported by the Obsidian-style markdown renderer.

## Wiki Links

Reference other posts with `[[slug]]` syntax:

- [[hello-world]] — links to this post
- [[hello-world|Read the intro]] — link with a custom label

## Images

Embed images stored in the blog images folder:

![[placeholder.png]]

Standard markdown images also work:

![Alt text](https://via.placeholder.com/800x400)

## Callouts

> [!NOTE]
> This is a note callout. Use it for supplementary information.

> [!TIP]
> This is a tip. Great for best practices or shortcuts.

> [!WARNING]
> This is a warning. Use when something could go wrong.

> [!DANGER]
> This is a danger callout. Reserved for critical issues.

## Code Blocks

```js
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet('world'));
```

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("world"))
```

## Tables

| Feature | Status |
|---|---|
| Wiki links | ✅ |
| Image embeds | ✅ |
| Callouts | ✅ |
| Syntax highlighting | ✅ |
| Tables | ✅ |
| Task lists | ✅ |

## Task Lists

- [x] Set up the blog
- [x] Write a sample post
- [ ] Write about a project
- [ ] Share it

## Text Formatting

**Bold**, *italic*, ~~strikethrough~~, and `inline code` all work.

> A standard blockquote looks like this.
