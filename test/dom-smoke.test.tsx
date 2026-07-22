// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Smoke test proving the jsdom environment, @testing-library/react, and the
 * jest-dom matchers are wired up. Component suites can opt into the DOM with
 * the `@vitest-environment jsdom` pragma at the top of the file (the default
 * environment is node — see vitest.config.mts).
 */
function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}!</p>;
}

describe("DOM test environment", () => {
  it("renders a component and matches on text", () => {
    render(<Greeting name="standup" />);
    expect(screen.getByText("Hello, standup!")).toBeInTheDocument();
  });
});
