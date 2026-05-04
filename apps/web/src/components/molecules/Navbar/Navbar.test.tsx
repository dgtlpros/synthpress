import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Navbar } from "./Navbar";

afterEach(cleanup);

describe("Navbar", () => {
  it("renders logo", () => {
    render(<Navbar />);
    expect(screen.getByAltText("SynthPress")).toBeInTheDocument();
  });

  it("renders nav links", () => {
    render(<Navbar />);
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("How It Works")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
  });

  it("renders Log In link pointing to /login", () => {
    render(<Navbar />);
    const loginLink = screen.getByText("Log In");
    expect(loginLink).toHaveAttribute("href", "/login");
  });

  it("renders Sign Up button pointing to /signup", () => {
    render(<Navbar />);
    const signUpBtn = screen.getByText("Sign Up");
    expect(signUpBtn).toHaveAttribute("href", "/signup");
  });
});
