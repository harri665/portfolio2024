import React from 'react';
import Container from './Container';

// How a section's index page opens: its name and one line, left-aligned under
// the wordmark. Art opens with PrismHero instead, over its 3D scene.
export default function SectionIntro({ title, children }) {
  return (
    <Container as="header" className="relative z-10 pb-10 pt-32 sm:pb-14 sm:pt-40">
      <h1 className="text-5xl font-semibold leading-none tracking-tight text-ink sm:text-6xl">
        {title}
      </h1>
      {children && (
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-2 sm:text-lg">{children}</p>
      )}
    </Container>
  );
}
